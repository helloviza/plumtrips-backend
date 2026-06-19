// apps/backend/src/services/tbo/flight.service.ts
import { httpFlight } from "../../lib/http.js";
import { authenticate, getEndUserIp, invalidateToken } from "./auth.service.js";
import airports from "../../data/airports.json" with { type: 'json' };
import airlines from "../../data/airlines.json" with { type: 'json' };

/* ------------------------------------------------------------------ */
/* NDC Airline Detection                                               */
/* ------------------------------------------------------------------ */

const NDC_AIRLINE_CODES = new Set(["EK", "LH", "BA", "SQ", "WY", "EY", "GF"]);
// Note: AI can be GDS or NDC depending on fare — treat as NDC when IsNDC flag is true on the flight result

export function isNDCFlight(airlineCode: string, isNDCFlag?: boolean): boolean {
  return NDC_AIRLINE_CODES.has(airlineCode) || isNDCFlag === true;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SearchSegment = {
  origin: string;
  destination: string;
  departDate: string;           // YYYY-MM-DD
};

export type SearchInput = {
  origin: string;
  destination: string;
  departDate: string;           // YYYY-MM-DD
  returnDate?: string;          // YYYY-MM-DD (omit for one-way)
  tripType?: string;            // "multiCity" for multi-stop
  segments?: SearchSegment[];   // multi-city legs (2-5)
  cabinClass?: number;          // 1=All, 2=Economy, 3=PremEco, 4=Business, 5=First
  adults?: number;
  children?: number;
  infants?: number;
  nonStopOnly?: boolean;        // -> DirectFlight
  oneStopOnly?: boolean;        // -> OneStopFlight
  preferredAirlines?: string[]; // e.g. ["AI","6E"]; empty => null
  fareType?: string;            // "Regular" | "Student" | "ArmedForces" | "SeniorCitizen"
};

export type Pax = {
  Title: "Mr" | "Ms" | "Mrs" | "Mstr" | "Miss";
  FirstName: string;
  LastName: string;
  PaxType: 1 | 2 | 3;        // 1=ADT, 2=CHD, 3=INF
  DateOfBirth: string;       // "YYYY-MM-DDT00:00:00"
  Gender: 1 | 2;             // 1=Male, 2=Female
  PassportNo?: string;
  PassportExpiry?: string;
  Pan?: string;
};

export type BookInput = {
  traceId: string;
  resultIndex: string | number;
  isLCC?: boolean;
  blockedFare?: boolean;
  passengers: Pax[];
  contact: { Email: string; Mobile: string };
  address?: {
    AddressLine?: string;
    AddressLine1?: string;
    AddressLine2?: string;
    City?: string;
    CountryCode?: string;
    ZipCode?: string;
  };
  gst?: {
    GSTCompanyAddress?: string;
    GSTCompanyContactNumber?: string;
    GSTCompanyName?: string;
    GSTNumber?: string;
    GSTCompanyEmail?: string;
  };
};

/* ------------------------------------------------------------------ */
/* TBO Response Types                                                  */
/* ------------------------------------------------------------------ */

export interface TBOMiniFareRule {
  JourneyPoints?: string;
  Type?: string;
  From?: string;
  To?: string;
  Unit?: string;
  Details?: string;
  OnlineRefundAllowed?: boolean;
}

export interface TBOFareBreakdown {
  BaseFare?: number;
  Tax?: number;
  YQTax?: number;
  AdditionalTxnFeeOfrd?: number;
  AdditionalTxnFeePub?: number;
  PGCharge?: number;
  SupplierReissueCharges?: number;
  Currency?: string;
  PaxType?: number;
  PassengerCount?: number;
  TaxBreakUp?: Array<{ key: string; value: number }>;
}

export interface TBOFare {
  BaseFare: number;
  Tax: number;
  TotalFare: number;
  PublishedFare: number;
  OfferedFare?: number;
  Currency: string;
  PGCharge?: number;
  TotalBaggageCharges?: number;
  TotalMealCharges?: number;
  TotalSeatCharges?: number;
  TotalSpecialServiceCharges?: number;
  TaxBreakup?: Array<{ key: string; value: number }>;
}

export interface TBOSegmentItem {
  Baggage?: string;
  CabinBaggage?: string;
  CabinClass?: number;
  Duration?: number;
  GroundTime?: number;
  Mile?: number;
  StopOver?: boolean;
  StopPoint?: string;
  NoOfSeatAvailable?: number;
  SupplierFareClass?: string | null;
  Remark?: string | null;
  FlightInfoIndex?: string;
  FareClassification?: { Type?: string };
  Airline: {
    AirlineCode: string;
    AirlineName: string;
    FlightNumber: string;
    FareClass?: string;
    OperatingCarrier?: string;
  };
  Origin: {
    DepTime: string;
    Airport: {
      AirportCode: string;
      AirportName?: string;
      Terminal?: string;
      CityCode?: string;
      CityName?: string;
      CountryCode?: string;
      CountryName?: string;
    };
  };
  Destination: {
    ArrTime: string;
    Airport: {
      AirportCode: string;
      AirportName?: string;
      Terminal?: string;
      CityCode?: string;
      CityName?: string;
      CountryCode?: string;
      CountryName?: string;
    };
  };
}

export interface TBOFlightResult {
  ResultIndex: string;
  IsLCC: boolean;
  NonRefundable: boolean;
  Fare: TBOFare;
  FareBreakdown?: TBOFareBreakdown[];
  Segments: TBOSegmentItem[][];
  IsPanRequiredAtBook?: boolean;
  IsPanRequiredAtTicket?: boolean;
  IsPassportRequiredAtBook?: boolean;
  IsPassportRequiredAtTicket?: boolean;
  IsPassportFullDetailRequiredAtBook?: boolean;
  GSTAllowed?: boolean;
  IsGSTMandatory?: boolean;
  FirstNameFormat?: string | null;
  LastNameFormat?: string | null;
  IsBookableIfSeatNotAvailable?: boolean;
  IsHoldAllowedWithSSR?: boolean;
  IsHoldMandatoryWithSSR?: boolean;
  ResultFareType?: string;
  ValidatingAirline?: string;
  AirlineCode?: string;
  FareClassification?: { Color?: string; Type?: string };
  SearchCombinationType?: number;
  IsTransitVisaRequired?: boolean;
  MiniFareRules?: TBOMiniFareRule[][];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const upper = (s: string) => String(s || "").trim().toUpperCase();

/**
 * TBO only accepts these 5 exact time strings for Preferred*Time fields.
 *
 *   "00:00:00"  → AnyTime   (no preference — returns ALL flights)
 *   "08:00:00"  → Morning
 *   "14:00:00"  → AfterNoon
 *   "19:00:00"  → Evening
 *   "01:00:00"  → Night
 *
 * ALWAYS use "00:00:00" for both PreferredDepartureTime and
 * PreferredArrivalTime unless the user explicitly filters by time-of-day.
 * Any other value (e.g. "23:59:00") causes ErrorCode 3 — Invalid Request.
 */
const TBO_ANY_TIME = "00:00:00";

/* ------------------------------------------------------------------ */
/* Passenger Sanitizers                                                */
/* ------------------------------------------------------------------ */

function sanitizeName(name: string): string {
  if (!name) return "X";
  let clean = name.replace(/[^a-zA-Z\s\-']/g, "").trim();
  clean = clean.replace(/\s{2,}/g, " ").replace(/-{2,}/g, "-");
  clean = clean.slice(0, 32).trim();
  return clean || "X";
}

function sanitizeTitle(title: string): string {
  const titleMap: Record<string, string> = {
    "MR": "Mr", "MRS": "Mrs", "MS": "Ms", "MISS": "Miss",
    "MSTR": "Mstr", "MASTER": "Master", "DR": "DR",
    "CHD": "CHD", "MST": "MST", "PROF": "PROF", "INF": "Inf",
  };
  const up = (title || "Mr").toUpperCase();
  return titleMap[up] || "Mr";
}

function sanitizeContactNo(raw: string | undefined, isLeadPax?: boolean): string {
  const digits = (raw || "").replace(/\D/g, "").slice(-10);
  if (digits.length >= 10) return digits;
  if (isLeadPax) throw new Error("Valid 10-digit phone number is required for lead passenger");
  throw new Error("Valid 10-digit phone number is required for passenger contact");
}

function sanitizePassportDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split("T")[0] + "T00:00:00";
  }
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return dateStr + "-01T00:00:00";
  }
  return "";
}

function sanitizeDOB(dob: string | undefined, paxType: number): string {
  if (!dob || !dob.trim()) {
    if (paxType === 2) throw new Error("Date of birth is required for Child passengers");
    if (paxType === 3) throw new Error("Date of birth is required for Infant passengers");
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(dob)) {
    return dob.includes("T") ? dob : dob + "T00:00:00";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
    const [day, month, year] = dob.split("/");
    return `${year}-${month}-${day}T00:00:00`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
    const [day, month, year] = dob.split("-");
    return `${year}-${month}-${day}T00:00:00`;
  }
  if (paxType === 2) throw new Error("Invalid date of birth format for Child passenger");
  if (paxType === 3) throw new Error("Invalid date of birth format for Infant passenger");
  return "";
}

/* ------------------------------------------------------------------ */
/* Airline-specific pre-booking validations                            */
/* ------------------------------------------------------------------ */

const SPICEJET_GULF_DESTINATIONS = new Set(["DXB", "RUH", "SHJ"]);
const NEPAL_DESTINATIONS = new Set(["KTM"]);

function validateAirlineSpecific(
  airlineCode: string,
  passengers: Array<Record<string, any>>,
  destinationCode: string,
): void {
  const code = (airlineCode || "").toUpperCase();

  if (code === "I5" || code === "AK") {
    const firstPax = passengers[0];
    if (firstPax && (!firstPax.CountryCode || !firstPax.CountryName)) {
      throw new Error("AirAsia requires CountryCode and CountryName for the first passenger");
    }
  }

  if (code === "SG") {
    for (const pax of passengers) {
      const first = (pax.FirstName || "").trim().toUpperCase();
      const last = (pax.LastName || "").trim().toUpperCase();
      if (first && last && first === last) {
        throw new Error(`SpiceJet requires First Name and Last Name to be different for passenger: ${pax.FirstName} ${pax.LastName}`);
      }
    }
  }

  const dest = (destinationCode || "").toUpperCase();

  if (code === "SG" && SPICEJET_GULF_DESTINATIONS.has(dest)) {
    for (const pax of passengers) {
      if (!pax.PassportNo) {
        const name = `${pax.FirstName || ""} ${pax.LastName || ""}`.trim();
        throw new Error(`Passport is mandatory for SpiceJet Gulf route (${dest}) — missing for: ${name}`);
      }
    }
  }

  if ((code === "SG" || code === "6E") && NEPAL_DESTINATIONS.has(dest)) {
    for (const pax of passengers) {
      const paxType = Number(pax.PaxType) || 1;
      if ((paxType === 1 || paxType === 2) && !pax.PassportNo) {
        const name = `${pax.FirstName || ""} ${pax.LastName || ""}`.trim();
        throw new Error(`Passport is mandatory for ${code === "SG" ? "SpiceJet" : "IndiGo"} flights to Nepal — missing for: ${name}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* SSR Sanitizers — strip extra fields TBO rejects                    */
/* ------------------------------------------------------------------ */

function normalizeFlightNumber(raw: any): string {
  if (raw === undefined || raw === null) return "";
  return String(raw).replace(/[^0-9]/g, "");
}

function sanitizeMealDynamic(meals: any[]): any[] {
  if (!Array.isArray(meals)) return [];
  return meals.map((m: any) => ({
    AirlineCode: m.AirlineCode ?? "",
    FlightNumber: m.FlightNumber ?? "",
    WayType: m.WayType ?? 2,
    Code: m.Code ?? "",
    Description: Number(m.Description) || 2,
    AirlineDescription: m.AirlineDescription ?? "",
    Quantity: m.Quantity ?? 1,
    Currency: m.Currency ?? "INR",
    Price: Number(m.Price) || 0,
    Origin: m.Origin ?? "",
    Destination: m.Destination ?? "",
  }));
}

function sanitizeBaggage(bags: any[]): any[] {
  if (!Array.isArray(bags)) return [];
  return bags.map((b: any) => ({
    AirlineCode: b.AirlineCode ?? "",
    FlightNumber: b.FlightNumber ?? "",
    WayType: b.WayType ?? 2,
    Code: b.Code ?? "",
    Description: Number(b.Description) || 2,
    Weight: b.Weight ?? 0,
    Currency: b.Currency ?? "INR",
    Price: Number(b.Price) || 0,
    Origin: b.Origin ?? "",
    Destination: b.Destination ?? "",
  }));
}

/**
 * Sanitize a single seat object to TBO Ticket format fields.
 *
 * IMPORTANT: AvailablityType, Compartment, Deck are FORCED to 0 —
 * SSR returns different values (1, 1, 1) but the certified Ticket
 * request always uses 0 for these fields.
 */
function sanitizeSeatObj(s: any): Record<string, any> {
  const rowNo = s.RowNo ?? (s.Code ? s.Code.replace(/[A-Z]/gi, "") : "");
  const rawSeatNo = s.SeatNo ?? "";
  const alreadyCombined = rawSeatNo.length > 1 && /\d/.test(rawSeatNo);
  const seatNo = alreadyCombined ? rawSeatNo : `${rowNo}${rawSeatNo}` || s.Code || "";

  return {
    AirlineCode: s.AirlineCode ?? "",
    FlightNumber: s.FlightNumber ?? "",
    CraftType: s.CraftType ?? "",
    Origin: s.Origin ?? "",
    Destination: s.Destination ?? "",
    AvailablityType: s.AvailablityType ?? 0,
    Description: Number(s.Description) || 2,
    Code: s.Code ?? "",
    RowNo: rowNo,
    SeatNo: seatNo,
    SeatType: s.SeatType ?? 0,
    SeatWayType: s.SeatWayType ?? 2,
    Compartment: s.Compartment ?? 0,
    Deck: s.Deck ?? 0,
    Currency: s.Currency ?? "INR",
    Price: Number(s.Price) || 0,
  };
}

/**
 * Sanitize SeatDynamic — flatten to flat array of seat objects.
 *
 * TBO Ticket API expects SeatDynamic as a FLAT array of seat objects,
 * NOT the nested SegmentSeat → RowSeats → Seats format from SSR.
 */
function sanitizeSeatDynamic(seats: any[]): any[] {
  if (!Array.isArray(seats) || seats.length === 0) return [];

  const result: any[] = [];

  for (const item of seats) {
    if (item.SegmentSeat) {
      for (const segSeat of item.SegmentSeat) {
        for (const rowSeat of segSeat.RowSeats || []) {
          for (const seat of rowSeat.Seats || []) {
            result.push(sanitizeSeatObj(seat));
          }
        }
      }
    } else if (item.WayType !== undefined && Array.isArray(item.Seat)) {
      for (const s of item.Seat) {
        result.push(sanitizeSeatObj(s));
      }
    } else if (item.AirlineCode || item.Code) {
      result.push(sanitizeSeatObj(item));
    }
  }

  return result;
}

function buildNoMealPlaceholder(ref: any): object {
  return {
    AirlineCode: ref?.AirlineCode || "",
    FlightNumber: ref?.FlightNumber || "",
    WayType: ref?.WayType ?? 2,
    Code: "NoMeal",
    Description: 2,
    AirlineDescription: "",
    Quantity: 0,
    Currency: "INR",
    Price: 0,
    Origin: ref?.Origin || "",
    Destination: ref?.Destination || "",
  };
}

function buildNoSeatPlaceholder(ref: any): object {
  return {
    AirlineCode: ref?.AirlineCode || "",
    FlightNumber: ref?.FlightNumber || "",
    CraftType: ref?.CraftType || "",
    Origin: ref?.Origin || "",
    Destination: ref?.Destination || "",
    AvailablityType: 0,
    Description: 2,
    Code: "NoSeat",
    RowNo: "0",
    SeatNo: null,
    SeatType: 0,
    SeatWayType: ref?.WayType ?? 2,
    Compartment: 0,
    Deck: 0,
    Currency: "INR",
    Price: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Calendar Prices — in-memory cache                                   */
/* ------------------------------------------------------------------ */

const calendarCache = new Map<string, { ts: number; data: Record<string, number> }>();
const calendarInFlight = new Map<string, Promise<Record<string, number>>>();
const CACHE_TTL_MS  = 30 * 60 * 1000; // 30 minutes

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchFlights(input: SearchInput) {
  const {
    origin, destination, departDate, returnDate,
    tripType,
    segments: multiSegments,
    cabinClass = 2,
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false,
    oneStopOnly = false,
    preferredAirlines = [],
    fareType,
  } = input || {};

  const isMultiCity =
    tripType === "multiCity" &&
    Array.isArray(multiSegments) &&
    multiSegments.length >= 2;

  if (!isMultiCity && (!origin || !destination || !departDate)) {
    throw new Error("origin, destination, departDate are required");
  }

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const AdultCount    = Number(adults);
  const ChildCount    = Number(children);
  const InfantCount   = Number(infants);
  const DirectFlight  = Boolean(nonStopOnly);
  const OneStopFlight = Boolean(oneStopOnly);

  type TBOSegment = {
    Origin: string;
    Destination: string;
    FlightCabinClass: number;
    PreferredDepartureTime: string;
    PreferredArrivalTime: string;
  };

  let JourneyType: number;
  let Segments: TBOSegment[];

  if (isMultiCity) {
    JourneyType = 3;
    Segments = multiSegments!.map((seg) => ({
      Origin:                   upper(seg.origin),
      Destination:              upper(seg.destination),
      FlightCabinClass:         cabinClass,
      PreferredDepartureTime:   `${seg.departDate}T${TBO_ANY_TIME}`,
      PreferredArrivalTime:     `${seg.departDate}T${TBO_ANY_TIME}`,
    }));
  } else if (returnDate) {
    JourneyType = 2;
    Segments = [
      {
        Origin:                 upper(origin),
        Destination:            upper(destination),
        FlightCabinClass:       cabinClass,
        PreferredDepartureTime: `${departDate}T${TBO_ANY_TIME}`,
        PreferredArrivalTime:   `${departDate}T${TBO_ANY_TIME}`,
      },
      {
        Origin:                 upper(destination),
        Destination:            upper(origin),
        FlightCabinClass:       cabinClass,
        PreferredDepartureTime: `${returnDate}T${TBO_ANY_TIME}`,
        PreferredArrivalTime:   `${returnDate}T${TBO_ANY_TIME}`,
      },
    ];
  } else {
    JourneyType = 1;
    Segments = [
      {
        Origin:                 upper(origin),
        Destination:            upper(destination),
        FlightCabinClass:       cabinClass,
        PreferredDepartureTime: `${departDate}T${TBO_ANY_TIME}`,
        PreferredArrivalTime:   `${departDate}T${TBO_ANY_TIME}`,
      },
    ];
  }

  const body: Record<string, unknown> = {
    EndUserIp,
    TokenId,
    AdultCount,
    ChildCount,
    InfantCount,
    DirectFlight,
    OneStopFlight,
    JourneyType,
    PreferredAirlines: preferredAirlines.length ? preferredAirlines : null,
    Segments,
    // Sources intentionally omitted — TBO uses account defaults.
  };

  if (fareType && fareType !== "Regular") {
    body.FareType = fareType;
  }

  console.log("[searchFlights] TokenId:", TokenId ? `${String(TokenId).slice(0, 8)}…` : "(empty)");
  console.log("[searchFlights] EndUserIp:", EndUserIp);
  console.log("[searchFlights] TBO request body:", JSON.stringify(body, null, 2));

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  console.log(
    "[searchFlights] TBO raw response status:", data?.Response?.ResponseStatus,
    "ErrorCode:", data?.Response?.Error?.ErrorCode,
    "ErrorMessage:", data?.Response?.Error?.ErrorMessage,
  );

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    if (err.ErrorCode === 6 || err.ErrorCode === 25) {
      console.log(`[searchFlights] No flights found (ErrorCode ${err.ErrorCode}) — returning empty results`);
      return {
        Response: {
          ResponseStatus: 1,
          Error: { ErrorCode: 0, ErrorMessage: "" },
          TraceId: data?.Response?.TraceId ?? "",
          Results: [],
          NoResultReason: err.ErrorMessage || "No flights found for this route/date",
        },
      };
    }
    throw new Error(err.ErrorMessage || `TBO Search failed (ErrorCode ${err.ErrorCode})`);
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Multi-City Search (dedicated)                                       */
/* ------------------------------------------------------------------ */

export async function searchMultiCity(params: {
  segments: Array<{
    origin: string;
    destination: string;
    departDate: string;
    cabinClass?: number;
  }>;
  adults?: number;
  children?: number;
  infants?: number;
}) {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const Segments = params.segments.map(seg => ({
    Origin:                 upper(seg.origin),
    Destination:            upper(seg.destination),
    FlightCabinClass:       seg.cabinClass ?? 2,
    PreferredDepartureTime: `${seg.departDate}T${TBO_ANY_TIME}`,
    PreferredArrivalTime:   `${seg.departDate}T${TBO_ANY_TIME}`,
  }));

  const body = {
    EndUserIp,
    TokenId,
    AdultCount:        Number(params.adults ?? 1),
    ChildCount:        Number(params.children ?? 0),
    InfantCount:       Number(params.infants ?? 0),
    DirectFlight:      false,
    OneStopFlight:     false,
    JourneyType:       3,
    PreferredAirlines: null,
    Segments,
    // Sources intentionally omitted
  };

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    if (err.ErrorCode === 6 || err.ErrorCode === 25) {
      return {
        Response: {
          ResponseStatus: 1,
          Error: { ErrorCode: 0, ErrorMessage: "" },
          TraceId: data?.Response?.TraceId ?? "",
          Results: [],
          NoResultReason: err.ErrorMessage || "No flights found for this route/date",
        },
      };
    }
    throw new Error(err.ErrorMessage || `TBO MultiCity Search failed (ErrorCode ${err.ErrorCode})`);
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Fare Rule / Fare Quote                                              */
/* ------------------------------------------------------------------ */

export async function getFareRule(input: { traceId: string; resultIndex: string | number }) {
  const { traceId, resultIndex } = input || {};
  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
  };

  const { data } = await httpFlight.post("/FareRule", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "FareRule failed");
  }
  return data;
}

export async function getFareQuote(input: { traceId: string; resultIndex: string | number }) {
  const { traceId, resultIndex } = input || {};
  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
  };

  const { data } = await httpFlight.post("/FareQuote", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    const msg = err.ErrorMessage || "";
    if (
      err.ErrorCode === 6 ||
      msg.toLowerCase().includes("session") ||
      msg.toLowerCase().includes("traceid") ||
      msg.toLowerCase().includes("expired")
    ) {
      invalidateToken();
      throw new Error("SESSION_EXPIRED");
    }
    throw new Error(msg || "FareQuote failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* PriceRBD                                                            */
/* ------------------------------------------------------------------ */

export async function getPriceRBD(params: {
  traceId: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  airSearchResult: Array<{
    ResultIndex: string;
    Source: number;
    IsLCC: boolean;
    IsRefundable: boolean;
    AirlineRemark: string;
    Segments: Array<Array<{
      TripIndicator: number;
      SegmentIndicator: number;
      Airline: {
        AirlineCode: string;
        AirlineName: string;
        FlightNumber: string;
        FareClass: string;
        OperatingCarrier: string;
      };
    }>>;
  }>;
}) {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId:        String(params.traceId),
    AdultCount:     params.adultCount,
    ChildCount:     params.childCount,
    InfantCount:    params.infantCount,
    AirSearchResult: params.airSearchResult,
  };

  const { data } = await httpFlight.post("/PriceRBD", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "PriceRBD failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* SSR — Seat Map + Meals + Baggage                                    */
/* ------------------------------------------------------------------ */

export type SSRInput = {
  traceId: string;
  resultIndex: string | number;
};

export async function getSSR(input: SSRInput & {
  skipFareQuote?: boolean;
  allResultIndexes?: string[];
}) {
  const { traceId, resultIndex, skipFareQuote = false } = input;
  // allResultIndexes is no longer used — each leg is called individually

  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  let ssrResultIndex: string | number = resultIndex;

  if (!skipFareQuote) {
    try {
      const fqBody = {
        EndUserIp,
        TokenId,
        TraceId:     String(traceId),
        ResultIndex: resultIndex,  // single leg only, never joined
      };

      console.log("[getSSR] FareQuote pre-call with ResultIndex:", resultIndex);

      const { data: fqData } = await httpFlight.post("/FareQuote", fqBody, {
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });

      const fqErr = fqData?.Response?.Error;
      if (fqErr && fqErr.ErrorCode && fqErr.ErrorCode !== 0) {
        console.warn("[getSSR] FareQuote error:", fqErr.ErrorCode, fqErr.ErrorMessage, "— using original ResultIndex");
      } else {
        const fqResult = fqData?.Response?.Results;
        // Results can be array (multi-city) or object (one-way/round-trip)
        const resolved = Array.isArray(fqResult)
          ? fqResult[0]?.ResultIndex
          : fqResult?.ResultIndex;
        if (resolved) {
          ssrResultIndex = resolved;
          console.log("[getSSR] FareQuote resolved ResultIndex:", ssrResultIndex);
        }
      }
    } catch (fqErr: any) {
      console.warn("[getSSR] FareQuote pre-call failed — using original ResultIndex:", fqErr.message);
    }
  }

  const body = {
    EndUserIp,
    TokenId,
    TraceId:     String(traceId),
    ResultIndex: ssrResultIndex,
  };

  console.log("[getSSR] Calling /SSR with ResultIndex:", ssrResultIndex);

  const { data } = await httpFlight.post("/SSR", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    const msg = err.ErrorMessage || "";
    console.log(`[getSSR] SSR ErrorCode ${err.ErrorCode}: ${msg} — returning empty`);
    if (msg.toLowerCase().includes("session") || msg.toLowerCase().includes("expired")) {
      invalidateToken();
    }
    return emptySSRResponse();
  }

  return data;
}

export function emptySSRResponse() {
  return {
    Response: {
      ResponseStatus: 1,
      Error: { ErrorCode: 0, ErrorMessage: "" },
      SeatDynamic: [],
      MealDynamic: [],
      Baggage:     [],
      SSRDynamic:  [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Book Flight (GDS)                                                   */
/* ------------------------------------------------------------------ */

export async function bookFlight(input: BookInput & {
  isNDC?: boolean;
  airlineCode?: string;
  destinationCode?: string;
  isPassportFullDetailRequired?: boolean;
  IsGSTMandatory?: boolean;
  GSTCompanyInfo?: {
    GSTCompanyName: string;
    GSTCompanyAddress: string;
    GSTCompanyContactNumber: string;
    GSTCompanyEmail: string;
    GSTIN: string;
  };
  isCorporate?: boolean;
  corporatePAN?: string;
}) {
  const {
    traceId, resultIndex,
    passengers,
    contact, address, gst,
    isLCC = false, blockedFare = false,
    isNDC = false,
    airlineCode,
    destinationCode,
    isPassportFullDetailRequired = false,
    IsGSTMandatory,
    GSTCompanyInfo,
    isCorporate,
    corporatePAN,
  } = input || {};

  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }
  if (!Array.isArray(passengers) || passengers.length < 1) {
    throw new Error("at least one passenger is required");
  }
  if (!contact?.Email || !contact?.Mobile) {
    throw new Error("contact Email and Mobile are required");
  }

  if (IsGSTMandatory === true && !GSTCompanyInfo) {
    throw new Error("GST company details are mandatory for this fare. Please provide your company GSTIN.");
  }

  const fq    = await getFareQuote({ traceId, resultIndex });
  const fqRes = fq?.Response?.Results;
  if (!fqRes) throw new Error("FareQuote missing Results");

  const fareByPaxType = new Map<number, any>();
  for (const bd of fqRes.FareBreakdown || []) {
    if (typeof bd?.PassengerType === "number") {
      fareByPaxType.set(bd.PassengerType, bd);
    }
  }

  const overallFare     = fqRes.Fare || {};
  const defaultCurrency = overallFare.Currency || "INR";

  const leadPax   = (passengers as any[]).find((p: any) => p.IsLeadPax) || (passengers as any[])[0];
  const leadEmail = leadPax?.Email || contact.Email;
  const ndcMode   = isNDC;

  const sanitizedPassengers = (passengers as any[]).map((p: any) => {
    const bd = fareByPaxType.get(p.PaxType);
    if (!bd) throw new Error(`FareQuote missing FareBreakdown for PaxType ${p.PaxType}`);

    const firstName = sanitizeName(p.FirstName || "");
    const lastName  = sanitizeName(p.LastName  || "");
    const paxType   = Number(p.PaxType) || 1;

    const fare = {
      Currency:                 bd.Currency || defaultCurrency,
      BaseFare:                 bd.BaseFare,
      Tax:                      bd.Tax,
      YQTax:                    bd.YQTax ?? overallFare.YQTax ?? 0,
      AdditionalTxnFeeOfrd:     overallFare.AdditionalTxnFeeOfrd ?? 0,
      AdditionalTxnFeePub:      overallFare.AdditionalTxnFeePub  ?? 0,
      PGCharge:                 overallFare.PGCharge              ?? 0,
      OtherCharges:             overallFare.OtherCharges          ?? 0,
      ServiceFee:               overallFare.ServiceFee            ?? 0,
    };

    const paxObj: Record<string, any> = {
      Title:                    sanitizeTitle(p.Title),
      FirstName:                firstName,
      LastName:                 lastName.length < 2 ? "XX" : lastName,
      PaxType:                  paxType,
      DateOfBirth:              sanitizeDOB(p.DateOfBirth, paxType),
      Gender:                   (() => {
                                  const g = Number(p.Gender);
                                  if (g !== 1 && g !== 2) throw new Error(`Gender is required for passenger: ${firstName}`);
                                  return g;
                                })(),
      PassportNo:               p.PassportNo || "",
      PassportExpiry:           sanitizePassportDate(p.PassportExpiry),
      PassportIssueCountryCode: p.PassportIssueCountryCode || p.passportIssueCountry || "IN",
      Nationality:              p.Nationality || "IN",
      AddressLine1:             address?.AddressLine1 || p.AddressLine1 || "India",
      AddressLine2:             address?.AddressLine2 || p.AddressLine2 || "",
      City:                     address?.City        || p.City         || "Delhi",
      CountryCode:              address?.CountryCode || p.CountryCode  || "IN",
      CountryName:              p.CountryName || "India",
      ContactNo:                sanitizeContactNo(p.ContactNo || contact.Mobile, p.IsLeadPax),
      Email:                    ndcMode ? (p.Email || leadEmail) : leadEmail,
      IsLeadPax:                p.IsLeadPax ?? false,
      FFAirlineCode:            p.FFAirlineCode || null,
      FFNumber:                 p.FFNumber || "",
      GSTCompanyAddress:        gst?.GSTCompanyAddress        || p.GSTCompanyAddress        || "",
      GSTCompanyContactNumber:  gst?.GSTCompanyContactNumber  || p.GSTCompanyContactNumber  || "",
      GSTCompanyName:           gst?.GSTCompanyName           || p.GSTCompanyName           || "",
      GSTNumber:                gst?.GSTNumber                || p.GSTNumber                || "",
      GSTCompanyEmail:          gst?.GSTCompanyEmail          || p.GSTCompanyEmail          || "",
      Fare:                     fare,
    };

    // Infant title override
    if (paxType === 3) {
      paxObj.Title = paxObj.Gender === 1 ? "Mstr" : "Miss";
    }

    // NDC: CellCountryCode mandatory, full passport always sent
    if (ndcMode) {
      paxObj.CellCountryCode  = "91";
      paxObj.PassportIssueDate = sanitizePassportDate(p.PassportIssueDate) || "2015-01-01T00:00:00";
    }

    if (isPassportFullDetailRequired && !ndcMode) {
      paxObj.PassportIssueDate = sanitizePassportDate(p.PassportIssueDate) || "2015-01-01T00:00:00";
    }

    // GuardianDetails for Child/Infant passengers
    if ((paxType === 2 || paxType === 3) && p.guardianDetails) {
      paxObj.GuardianDetails = {
        Title:     sanitizeTitle(p.guardianDetails.Title),
        FirstName: sanitizeName(p.guardianDetails.FirstName),
        LastName:  sanitizeName(p.guardianDetails.LastName),
        ...(p.guardianDetails.PAN        ? { PAN:        p.guardianDetails.PAN        } : {}),
        ...(p.guardianDetails.PassportNo ? { PassportNo: p.guardianDetails.PassportNo } : {}),
      };
    }

    return paxObj;
  });

  // Enforce exactly one IsLeadPax=true
  const leadIndices = sanitizedPassengers
    .map((p, i) => (p.IsLeadPax === true ? i : -1))
    .filter(i => i !== -1);
  if (leadIndices.length === 0) {
    const firstAdult = sanitizedPassengers.findIndex(p => p.PaxType === 1);
    sanitizedPassengers[firstAdult !== -1 ? firstAdult : 0].IsLeadPax = true;
  } else if (leadIndices.length > 1) {
    for (let k = 1; k < leadIndices.length; k++) {
      sanitizedPassengers[leadIndices[k]].IsLeadPax = false;
    }
  }

  // Airline-specific validations
  if (airlineCode) {
    validateAirlineSpecific(airlineCode, sanitizedPassengers, destinationCode || "");
  }

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body: Record<string, unknown> = {
    EndUserIp,
    TokenId,
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
    Passengers:  sanitizedPassengers,
    Address: {
      AddressLine: address?.AddressLine || address?.AddressLine1 || "N/A",
      City:        address?.City        || "Delhi",
      CountryCode: address?.CountryCode || "IN",
      ZipCode:     address?.ZipCode     || "110001",
    },
    Contact: {
      Email:  contact.Email,
      Mobile: contact.Mobile,
    },
    GSTCompanyAddress:       gst?.GSTCompanyAddress       || "",
    GSTCompanyContactNumber: gst?.GSTCompanyContactNumber || "",
    GSTCompanyName:          gst?.GSTCompanyName          || "",
    GSTNumber:               gst?.GSTNumber               || "",
    GSTCompanyEmail:         gst?.GSTCompanyEmail         || "",
    IsLCC:       Boolean(isLCC),
    BlockedFare: Boolean(blockedFare),
    IsPriceChangeAccepted: false,
  };

  if (GSTCompanyInfo) body.GSTCompanyInfo = GSTCompanyInfo;
  if (isCorporate && corporatePAN) {
    body.IsCorporate  = true;
    body.CorporatePAN = corporatePAN;
  }

  console.log("[bookFlight] Segments from input:", (input as any).segments);
  console.log("[bookFlight] TBO booking body passengers:", JSON.stringify(body.Passengers, null, 2));

  const { data } = await httpFlight.post("/Book", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    console.error("[bookFlight] TBO Error Response:", JSON.stringify(err, null, 2));
    throw new Error(err.ErrorMessage || "Book failed");
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Ticket — GDS (non-LCC)                                             */
/* ------------------------------------------------------------------ */

export async function ticketFlight(input: {
  bookingId: number | string;
  pnr?: string;
  traceId?: string;
}) {
  const { bookingId, pnr = "", traceId } = input || {};
  if (!bookingId) throw new Error("bookingId is required");

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body: any = {
    EndUserIp,
    TokenId,
    BookingId: Number(bookingId),
    PNR:       String(pnr || ""),
  };
  if (traceId) body.TraceId = String(traceId);

  const { data } = await httpFlight.post("/Ticket", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  // Auto-retry with IsPriceChangeAccepted if TBO signals price changed
  if (data?.Response?.IsPriceChanged === true) {
    const retryBody = { ...body, IsPriceChangeAccepted: true };
    const { data: retryData } = await httpFlight.post("/Ticket", retryBody, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    return retryData;
  }

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "Ticket failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Ticket LCC — with full SSR/seat/meal sanitization                  */
/* ------------------------------------------------------------------ */

export async function ticketLCC(params: {
  traceId: string;
  resultIndex: string | number;
  passengers: Array<Record<string, any> & {
    guardianDetails?: {
      Title?: string;
      FirstName: string;
      LastName: string;
      PAN?: string;
      PassportNo?: string;
    };
  }>;
  contact?: { Email?: string; Mobile?: string };
  gst?: {
    GSTCompanyAddress?: string;
    GSTCompanyContactNumber?: string;
    GSTCompanyName?: string;
    GSTNumber?: string;
    GSTCompanyEmail?: string;
  };
  isPriceChangeAccepted?: boolean;
  isNDC?: boolean;
  isInternational?: boolean;
  airlineCode?: string;
  destinationCode?: string;
  segments?: Array<Array<{ Origin: { Airport: { CountryCode?: string } }; Destination: { Airport: { CountryCode?: string } } }>>;
  freeBaggage?: Array<{ AirlineCode: string; FlightNumber: string; WayType: number; Code: string; Description: number; Weight: number; Currency: string; Price: number; Origin: string; Destination: string }>;
  IsGSTMandatory?: boolean;
  GSTCompanyInfo?: {
    GSTCompanyName: string;
    GSTCompanyAddress: string;
    GSTCompanyContactNumber: string;
    GSTCompanyEmail: string;
    GSTIN: string;
  };
  isCorporate?: boolean;
  corporatePAN?: string;
}) {
  const {
    traceId, resultIndex,
    passengers,
    contact,
    gst,
    isPriceChangeAccepted = false,
    isNDC = false,
    airlineCode,
    destinationCode,
    IsGSTMandatory,
    GSTCompanyInfo,
    isCorporate,
    corporatePAN,
  } = params;

  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }
  if (!Array.isArray(passengers) || passengers.length < 1) {
    throw new Error("at least one passenger is required");
  }
  const fallbackContact = {
    Email: contact?.Email || passengers.find((p: any) => p?.Email)?.Email || "",
    Mobile: contact?.Mobile || passengers.find((p: any) => p?.ContactNo)?.ContactNo || "",
  };

  if (!fallbackContact.Email || !fallbackContact.Mobile) {
    throw new Error("contact Email and Mobile are required");
  }
  if (IsGSTMandatory === true && !GSTCompanyInfo) {
    throw new Error("GST company details are mandatory for this fare. Please provide your company GSTIN.");
  }

  const fq    = await getFareQuote({ traceId, resultIndex });
  const fqRes = fq?.Response?.Results;
  if (!fqRes) throw new Error("FareQuote missing Results");

  const fareByPaxType = new Map<number, any>();
  for (const bd of fqRes.FareBreakdown || []) {
    const passengerType = bd?.PassengerType ?? bd?.PaxType;
    if (typeof passengerType === "number") {
      fareByPaxType.set(passengerType, bd);
    }
  }

  const overallFare     = fqRes.Fare || {};
  const defaultCurrency = overallFare.Currency || "INR";

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const ndcMode   = isNDC;
  const lccLeadPax   = ndcMode
    ? ((passengers as any[]).find((p: any) => p.IsLeadPax) || (passengers as any[])[0])
    : null;
  const lccLeadEmail = lccLeadPax?.Email || "";

  const isInternational = params.isInternational ?? (
    Array.isArray(params.segments) && params.segments.some(journey =>
      journey.some(seg =>
        seg.Origin?.Airport?.CountryCode !== "IN" ||
        seg.Destination?.Airport?.CountryCode !== "IN"
      )
    )
  );

  const sanitizedPassengers = (passengers as any[]).map((p: any) => {
    const firstName = sanitizeName(p.FirstName);
    const lastName  = sanitizeName(p.LastName);
    const paxType   = Number(p.PaxType) || 1;
    const bd = fareByPaxType.get(paxType) || overallFare;
    const passengerFare = p.Fare || {};

    const pax: Record<string, unknown> = {
      Title:       sanitizeTitle(p.Title),
      FirstName:   firstName,
      LastName:    lastName.length < 2 ? "XX" : lastName,
      PaxType:     paxType,
      DateOfBirth: sanitizeDOB(p.DateOfBirth, paxType),
      Gender:      (() => {
                     const g = Number(p.Gender);
                     if (g !== 1 && g !== 2) throw new Error(`Gender is required for passenger: ${firstName} ${lastName.length < 2 ? "XX" : lastName}`);
                     return g;
                   })(),
      PassportNo:      p.PassportNo || "",
      PassportExpiry:  sanitizePassportDate(p.PassportExpiry),
      ContactNo:       sanitizeContactNo(p.ContactNo || fallbackContact.Mobile, p.IsLeadPax),
      Email:           ndcMode ? (p.Email || lccLeadEmail || fallbackContact.Email) : (p.Email || fallbackContact.Email),
      IsLeadPax:       p.IsLeadPax ?? false,
      CountryCode:     p.CountryCode || "IN",
      CountryName:     p.CountryName || "India",
      Nationality:     p.Nationality || "IN",
      City:            p.City || "Delhi",
      AddressLine1:    p.AddressLine1 || "India",
      AddressLine2:    p.AddressLine2 || "",
      FFAirlineCode:   p.FFAirlineCode || null,
      FFNumber:        p.FFNumber || "",
      GSTCompanyAddress:       gst?.GSTCompanyAddress       || p.GSTCompanyAddress       || "",
      GSTCompanyContactNumber: gst?.GSTCompanyContactNumber || p.GSTCompanyContactNumber || "",
      GSTCompanyName:          gst?.GSTCompanyName          || p.GSTCompanyName          || "",
      GSTNumber:               gst?.GSTNumber               || p.GSTNumber               || "",
      GSTCompanyEmail:         gst?.GSTCompanyEmail         || p.GSTCompanyEmail         || "",
      Fare: {
        Currency:             passengerFare.Currency || bd.Currency || defaultCurrency,
        BaseFare:             Number(passengerFare.BaseFare ?? bd.BaseFare ?? overallFare.BaseFare) || 0,
        Tax:                  Number(passengerFare.Tax ?? bd.Tax ?? overallFare.Tax) || 0,
        YQTax:                Number(passengerFare.YQTax ?? bd.YQTax ?? overallFare.YQTax) || 0,
        AdditionalTxnFeeOfrd: Number(passengerFare.AdditionalTxnFeeOfrd ?? overallFare.AdditionalTxnFeeOfrd) || 0,
        AdditionalTxnFeePub:  Number(passengerFare.AdditionalTxnFeePub ?? overallFare.AdditionalTxnFeePub) || 0,
        PGCharge:             Number(passengerFare.PGCharge ?? overallFare.PGCharge) || 0,
        OtherCharges:         Number(passengerFare.OtherCharges ?? overallFare.OtherCharges) || 0,
        Discount:             Number(passengerFare.Discount ?? overallFare.Discount) || 0,
        PublishedFare:        Number(passengerFare.PublishedFare ?? overallFare.PublishedFare) || 0,
        OfferedFare:          Number(passengerFare.OfferedFare ?? overallFare.OfferedFare) || 0,
        TdsOnCommission:      Number(passengerFare.TdsOnCommission ?? overallFare.TdsOnCommission) || 0,
        TdsOnPLB:             Number(passengerFare.TdsOnPLB ?? overallFare.TdsOnPLB) || 0,
        TdsOnIncentive:       Number(passengerFare.TdsOnIncentive ?? overallFare.TdsOnIncentive) || 0,
        ServiceFee:           Number(passengerFare.ServiceFee ?? overallFare.ServiceFee) || 0,
        TransactionFee:       Number(passengerFare.TransactionFee ?? overallFare.TransactionFee) || 0,
        AirTransFee:          Number(passengerFare.AirTransFee ?? overallFare.AirTransFee) || 0,
        CommissionEarned:     Number(passengerFare.CommissionEarned ?? overallFare.CommissionEarned) || 0,
        PLBEarned:            Number(passengerFare.PLBEarned ?? overallFare.PLBEarned) || 0,
        IncentiveEarned:      Number(passengerFare.IncentiveEarned ?? overallFare.IncentiveEarned) || 0,
      },
    };

    // Infant title override
    if (pax.PaxType === 3) {
      pax.Title = pax.Gender === 1 ? "Mstr" : "Miss";
    }

    // GuardianDetails for Child/Infant passengers
    if ((pax.PaxType === 2 || pax.PaxType === 3) && p.guardianDetails) {
      pax.GuardianDetails = {
        Title:     sanitizeTitle(p.guardianDetails.Title),
        FirstName: sanitizeName(p.guardianDetails.FirstName),
        LastName:  sanitizeName(p.guardianDetails.LastName),
        ...(p.guardianDetails.PAN        ? { PAN:        p.guardianDetails.PAN        } : {}),
        ...(p.guardianDetails.PassportNo ? { PassportNo: p.guardianDetails.PassportNo } : {}),
      };
    }

    // NDC: CellCountryCode mandatory, full passport always sent
    if (ndcMode) {
      pax.CellCountryCode  = "91";
      pax.PassportIssueDate = sanitizePassportDate(p.PassportIssueDate) || "2015-01-01T00:00:00";
    }

    // ── Meals ──────────────────────────────────────────────────────
    const MEAL_PLACEHOLDERS = ["nomeal", "no_meal", "none", "no meal", "no meal preference","NoMeal"];
    const BAGGAGE_PLACEHOLDERS = ["nobaggage", "no_baggage", "none", "no baggage", "included only","NoBaggage"];
    const rawMeals = Array.isArray(p.MealDynamic) ? p.MealDynamic : [];
    const rawBaggage = Array.isArray(p.Baggage) ? p.Baggage : [];
    const bookedFlightNumbers = params.segments
      ? (params.segments as any[][]).flat().map((s: any) => String(s.FlightNumber || "")).filter(Boolean)
      : [];
    const bookedFlightNumberSet = new Set<string>([
      ...bookedFlightNumbers,
      ...bookedFlightNumbers.map(normalizeFlightNumber).filter(Boolean),
    ]);

    const validMeals = sanitizeMealDynamic(rawMeals).filter((m: any) => {
      const normalizedMealNo = normalizeFlightNumber(m.FlightNumber);
      const code = String(m.Code || "").trim().toLowerCase();
      return (
        code &&
        m.AirlineCode && m.FlightNumber &&
        (bookedFlightNumberSet.size === 0 ||
          bookedFlightNumberSet.has(String(m.FlightNumber)) ||
          (normalizedMealNo && bookedFlightNumberSet.has(normalizedMealNo)))
      );
    }).map((m: any) => {
      const code = String(m.Code || "").trim().toLowerCase();
      if (MEAL_PLACEHOLDERS.includes(code)) {
        return { ...m, Code: "NoMeal", Quantity: 0, Price: 0 };
      }
      return m;
    });
    if (validMeals.length > 0) {
      pax.MealDynamic = validMeals;
    }

    const validBaggage = sanitizeBaggage(rawBaggage).filter((b: any) => {
      const normalizedBagFlightNo = normalizeFlightNumber(b.FlightNumber);
      const code = String(b.Code || "").trim().toLowerCase();
      return (
        code &&
        b.AirlineCode && b.FlightNumber &&
        (bookedFlightNumberSet.size === 0 ||
          bookedFlightNumberSet.has(String(b.FlightNumber)) ||
          (normalizedBagFlightNo && bookedFlightNumberSet.has(normalizedBagFlightNo)))
      );
    }).map((b: any) => {
      const code = String(b.Code || "").trim().toLowerCase();
      if (BAGGAGE_PLACEHOLDERS.includes(code)) {
        return { ...b, Code: "NoBaggage", Weight: 0, Price: 0 };
      }
      return b;
    });
    if (validBaggage.length > 0) {
      pax.Baggage = validBaggage;
    }

    // ── Seats ──────────────────────────────────────────────────────
    if (Array.isArray(p.SeatDynamic) && p.SeatDynamic.length > 0) {
      const firstItem = p.SeatDynamic[0];
      const isAlreadyNested = firstItem != null && "SegmentSeat" in firstItem;

      if (isAlreadyNested) {
        pax.SeatDynamic = p.SeatDynamic.map((segSeatObj: any) => ({
          SegmentSeat: (segSeatObj.SegmentSeat || []).map((seg: any) => ({
            RowSeats: (seg.RowSeats || []).map((row: any) => ({
              Seats: (row.Seats || []).map((s: any) => {
                const rowNo = String(s.RowNo ?? "");
                const rawSeatNo = s.SeatNo ?? "";
                const alreadyCombined = rawSeatNo.length > 1 && /\d/.test(rawSeatNo);
                const seatNo = alreadyCombined ? rawSeatNo : `${rowNo}${rawSeatNo}` || s.Code || "";
                return {
                  AirlineCode:      s.AirlineCode ?? "",
                  FlightNumber:     s.FlightNumber ?? "",
                  CraftType:        s.CraftType ?? "",
                  Origin:           s.Origin ?? "",
                  Destination:      s.Destination ?? "",
                  AvailablityType:  s.AvailablityType ?? 1,
                  Description:      s.Description ?? 2,
                  Code:             s.Code ?? "",
                  RowNo:            rowNo,
                  SeatNo:           seatNo,
                  SeatType:         s.SeatType ?? 1,
                  SeatWayType:      s.SeatWayType ?? 1,
                  Compartment:      s.Compartment ?? 1,
                  Deck:             s.Deck ?? 1,
                  Currency:         s.Currency ?? "INR",
                  Price:            Number(s.Price) || 0,
                };
              })
            }))
          }))
        }));
      } else {
        // Flat array — wrap into TBO nested structure
        const seatObjects = p.SeatDynamic.map((s: any) => {
          const rowNo = String(s.RowNo ?? "");
          const rawSeatNo = s.SeatNo ?? "";
          const alreadyCombined = rawSeatNo.length > 1 && /\d/.test(rawSeatNo);
          const seatNo = alreadyCombined ? rawSeatNo : `${rowNo}${rawSeatNo}` || s.Code || "";
          return {
            AirlineCode:      s.AirlineCode ?? "",
            FlightNumber:     s.FlightNumber ?? "",
            CraftType:        s.CraftType ?? "",
            Origin:           s.Origin ?? "",
            Destination:      s.Destination ?? "",
            AvailablityType:  s.AvailablityType ?? 1,
            Description:      s.Description ?? 2,
            Code:             s.Code ?? "",
            RowNo:            rowNo,
            SeatNo:           seatNo,
            SeatType:         s.SeatType ?? 1,
            SeatWayType:      s.SeatWayType ?? 1,
            Compartment:      s.Compartment ?? 1,
            Deck:             s.Deck ?? 1,
            Currency:         s.Currency ?? "INR",
            Price:            Number(s.Price) || 0,
          };
        });
        pax.SeatDynamic = [{
          SegmentSeat: [{ RowSeats: [{ Seats: seatObjects }] }],
        }];
      }
    }

    if (p.SeatPreference !== undefined && !pax.SeatDynamic) {
      pax.SeatPreference = p.SeatPreference;
    }

    // Infants cannot have SSR
    if (Number(p.PaxType) === 3) {
      delete pax.MealDynamic;
      delete pax.Baggage;
      delete pax.SeatDynamic;
      delete pax.SeatPreference;
    }

    return pax;
  });

  // Enforce exactly one IsLeadPax=true
  const leadIndices = sanitizedPassengers
    .map((p, i) => (p.IsLeadPax === true ? i : -1))
    .filter(i => i !== -1);
  if (leadIndices.length === 0) {
    const firstAdult = sanitizedPassengers.findIndex(p => p.PaxType === 1);
    sanitizedPassengers[firstAdult !== -1 ? firstAdult : 0].IsLeadPax = true;
  } else if (leadIndices.length > 1) {
    for (let k = 1; k < leadIndices.length; k++) {
      sanitizedPassengers[leadIndices[k]].IsLeadPax = false;
    }
  }

  // Airline-specific validations
  if (airlineCode) {
    validateAirlineSpecific(airlineCode, sanitizedPassengers, destinationCode || "");
  }

  const payload: Record<string, unknown> = {
    EndUserIp,
    TokenId,
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
    Passengers:  sanitizedPassengers,
    IsPriceChangeAccepted: isPriceChangeAccepted,
  };

  if (GSTCompanyInfo) payload.GSTCompanyInfo = GSTCompanyInfo;
  if (isCorporate && corporatePAN) {
    payload.IsCorporate  = true;
    payload.CorporatePAN = corporatePAN;
  }

  const { data } = await httpFlight.post("/Ticket", payload, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const respStatus = data?.Response?.ResponseStatus ?? data?.Response?.Response?.ResponseStatus;
  const respError  = data?.Response?.Error          ?? data?.Response?.Response?.Error;
  if (respStatus !== 1) {
    console.warn("[TBO TICKET LCC ERROR]", JSON.stringify({
      ResponseStatus: respStatus,
      Error: respError,
      TraceId: data?.Response?.TraceId,
    }));
  }

  if (respError?.ErrorCode && respError.ErrorCode !== 0) {
    throw new Error(respError.ErrorMessage || "LCC ticket failed");
  }

  // Auto-retry with IsPriceChangeAccepted if TBO signals price changed
  if (data?.Response?.IsPriceChanged === true || data?.Response?.Response?.IsPriceChanged === true) {
    const { data: retryData } = await httpFlight.post("/Ticket", { ...payload, IsPriceChangeAccepted: true }, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const retryError = retryData?.Response?.Error ?? retryData?.Response?.Response?.Error;
    if (retryError?.ErrorCode && retryError.ErrorCode !== 0) {
      throw new Error(retryError.ErrorMessage || "LCC ticket failed");
    }
    return retryData;
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                        */
/* ------------------------------------------------------------------ */

export async function cancelFlight(params: {
  bookingId: number;
  ticketId: number[];
  requestType?: number;
  cancellationType?: number;
  remarks?: string;
}): Promise<any> {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const requestType = params.requestType ?? 1;
  const payload: Record<string, unknown> = {
    EndUserIp,
    TokenId,
    BookingId:        Number(params.bookingId),
    RequestType:      requestType,
    CancellationType: params.cancellationType ?? 3,
    Remarks:          params.remarks || "Cancelled by user",
  };

  // TicketId only valid for partial cancellation (requestType !== 1)
  if (requestType !== 1 && params.ticketId?.length) {
    payload.TicketId = params.ticketId;
  }

  const { data } = await httpFlight.post("/SendChangeRequest", payload, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "CancelFlight failed");
  }
  return data;
}

export async function getCancellationCharges(params: {
  bookingId: number;
  requestType?: number;
  bookingMode?: number;
}): Promise<{
  ok: boolean;
  refundAmount?: number;
  cancellationCharge?: number;
  remarks?: string;
  raw: unknown;
  error?: { code: number; message: string };
}> {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const { data } = await httpFlight.post("/GetCancellationCharges", {
    EndUserIp,
    TokenId,
    RequestType: params.requestType ?? 1,
    BookingId:   Number(params.bookingId),
    BookingMode: params.bookingMode ?? 5,
  }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const status = data?.Response?.ResponseStatus;
  if (status !== 1) {
    const errCode: number = data?.Response?.Error?.ErrorCode ?? 0;
    const errMsg: string  = data?.Response?.Error?.ErrorMessage ?? "Could not retrieve cancellation charges";
    return { ok: false, raw: data, error: { code: errCode, message: errMsg } };
  }
  return {
    ok: true,
    refundAmount:       data?.Response?.RefundAmount,
    cancellationCharge: data?.Response?.CancellationCharge,
    remarks:            data?.Response?.Remarks,
    raw:                data,
  };
}

export async function releasePNR(params: {
  bookingId: number;
  pnr: string;
}) {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const { data } = await httpFlight.post("/ReleasePNRRequest", {
    EndUserIp,
    TokenId,
    BookingId: params.bookingId,
    PNR:       params.pnr,
  }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "ReleasePNR failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Booking Details                                                     */
/* ------------------------------------------------------------------ */

export async function getBookingDetails(input: { bookingId: number | string }) {
  const { bookingId } = input || {};
  if (!bookingId) throw new Error("bookingId is required");

  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const { data } = await httpFlight.post("/GetBookingDetails", {
    EndUserIp,
    TokenId,
    BookingId: Number(bookingId),
  }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "GetBookingDetails failed");
  }
  return data;
}

export async function getBookingDetailsByPNR(params: {
  pnr: string;
  firstName: string;
  lastName?: string;
}) {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const { data } = await httpFlight.post("/GetBookingDetails", {
    EndUserIp,
    TokenId,
    PNR:       params.pnr,
    FirstName: params.firstName,
    LastName:  params.lastName || "",
  }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "GetBookingDetailsByPNR failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Reissue                                                             */
/* ------------------------------------------------------------------ */

export async function reissueSearch(params: {
  origin: string;
  destination: string;
  departDate: string;
  adults?: number;
  children?: number;
  infants?: number;
  cabinClass?: number;
  pnr: string;
  bookingId: string;
}): Promise<unknown> {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    AdultCount:        Number(params.adults   ?? 1),
    ChildCount:        Number(params.children ?? 0),
    InfantCount:       Number(params.infants  ?? 0),
    DirectFlight:      false,
    OneStopFlight:     false,
    JourneyType:       1,
    PreferredAirlines: null,
    Segments: [
      {
        Origin:                 upper(params.origin),
        Destination:            upper(params.destination),
        FlightCabinClass:       params.cabinClass ?? 2,
        PreferredDepartureTime: `${params.departDate}T${TBO_ANY_TIME}`,
        PreferredArrivalTime:   `${params.departDate}T${TBO_ANY_TIME}`,
      },
    ],
    Sources:    null,
    SearchType: 1,
    Pnr:        params.pnr,
    Bookingid:  Number(params.bookingId),
  };

  console.log("[reissueSearch] body:", JSON.stringify(body, null, 2));

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    if (err.ErrorCode === 6 || err.ErrorCode === 25) {
      return {
        Response: {
          ResponseStatus: 1,
          Error: { ErrorCode: 0, ErrorMessage: "" },
          TraceId: data?.Response?.TraceId ?? "",
          Results: [],
          NoResultReason: err.ErrorMessage || "No reissue flights found",
        },
      };
    }
    throw new Error(err.ErrorMessage || `Reissue Search failed (ErrorCode ${err.ErrorCode})`);
  }
  return data;
}

export async function ticketReissue(params: {
  traceId: string;
  resultIndex: string;
  passengers: Array<Record<string, unknown>>;
  pnr: string;
  bookingId: number;
  ticketData?: {
    TourCode?: string;
    Endorsement?: string;
    CorporateCode?: string;
    AgentDealCode?: string;
  };
}): Promise<unknown> {
  const TokenId   = await authenticate();
  const EndUserIp = getEndUserIp();

  const { data } = await httpFlight.post("/TicketReIssue", {
    EndUserIp,
    TokenId,
    TraceId:     params.traceId,
    ResultIndex: params.resultIndex,
    Passengers:  params.passengers,
    PNR:         params.pnr,
    BookingId:   Number(params.bookingId),
    IsPriceChangeAccepted: true,
    TicketData:  params.ticketData ?? {},
  }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "TicketReissue failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Airports & Airlines                                                 */
/* ------------------------------------------------------------------ */

export type Airport = {
  code: string;
  name: string;
  city: string;
  cityCode: string;
  country: string;
  countryCode: string;
  label: string;
};

export type Airline = {
  code: string;
  name: string;
};

export function getAirports(): Airport[] {
  return airports as Airport[];
}

export function getAirlines(): Airline[] {
  return Object.entries(airlines as Record<string, string>).map(
    ([code, name]) => ({ code, name })
  );
}

/* ------------------------------------------------------------------ */
/* Calendar Prices                                                     */
/* ------------------------------------------------------------------ */

export type CalendarPricesInput = {
  from: string;
  to: string;
  cabinClass?: number;
  daysAhead?: number;
  concurrency?: number;
};

export async function getCalendarPrices(
  input: CalendarPricesInput
): Promise<Record<string, number>> {
  const {
    from,
    to,
    cabinClass = 2,
    daysAhead  = 62,
    concurrency = 12,
  } = input;

  const safeDaysAhead = Math.min(Math.max(Number(daysAhead) || 62, 1), 90);
  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 12, 1), 16);
  const cacheKey = `${from}-${to}-${cabinClass}-${safeDaysAhead}`;
  const cached   = calendarCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(`[getCalendarPrices] cache hit for ${cacheKey} (${Object.keys(cached.data).length} dates)`);
    return cached.data;
  }

  const inFlight = calendarInFlight.get(cacheKey);
  if (inFlight) {
    console.log(`[getCalendarPrices] joining in-flight request for ${cacheKey}`);
    return inFlight;
  }

  const request = fetchCalendarPrices({
    from,
    to,
    cabinClass,
    daysAhead: safeDaysAhead,
    concurrency: safeConcurrency,
    cacheKey,
  }).finally(() => {
    calendarInFlight.delete(cacheKey);
  });

  calendarInFlight.set(cacheKey, request);
  return request;
}

async function fetchCalendarPrices({
  from,
  to,
  cabinClass,
  daysAhead,
  concurrency,
  cacheKey,
}: {
  from: string;
  to: string;
  cabinClass: number;
  daysAhead: number;
  concurrency: number;
  cacheKey: string;
}): Promise<Record<string, number>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const dd   = String(d.getDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }

  const priceMap: Record<string, number> = {};

  // Authenticate once — reusing token across all date batches prevents
  // TBO from issuing a new session that invalidates the TraceId from
  // the user's actual flight search.
  const calToken = await authenticate();
  const calIp    = getEndUserIp();

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, dates.length);

  await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < dates.length) {
        const date = dates[nextIndex++];

        try {
          const { data } = await httpFlight.post(
            "/Search",
            {
              EndUserIp:         calIp,
              TokenId:           calToken,
              AdultCount:        1,
              ChildCount:        0,
              InfantCount:       0,
              DirectFlight:      false,
              OneStopFlight:     false,
              JourneyType:       1,
              PreferredAirlines: null,
              Segments: [
                {
                  Origin:                 upper(from),
                  Destination:            upper(to),
                  FlightCabinClass:       cabinClass,
                  PreferredDepartureTime: `${date}T00:00:00`,
                  PreferredArrivalTime:   `${date}T00:00:00`,
                },
              ],
            },
            { headers: { "Content-Type": "application/json", Accept: "application/json" } }
          );

          const rawResults = data?.Response?.Results ?? [];
          const sourceGroups: any[][] = Array.isArray(rawResults[0])
            ? rawResults
            : rawResults.length > 0 ? [rawResults] : [];

          let cheapest: number | null = null;
          for (const sourceGroup of sourceGroups) {
            if (!Array.isArray(sourceGroup)) continue;
            for (const flight of sourceGroup) {
              const fare = flight?.Fare?.OfferedFare;
              if (typeof fare === "number" && fare > 0) {
                if (cheapest === null || fare < cheapest) cheapest = fare;
              }
            }
          }

          if (cheapest !== null) priceMap[date] = cheapest;
        } catch (err: any) {
          console.warn(`[getCalendarPrices] skipped ${date} (${from}→${to}):`, err.message);
        }
      }
    })
  );

  console.log(
    `[getCalendarPrices] ${from}→${to}: got prices for ${Object.keys(priceMap).length}/${daysAhead} dates`
  );

  calendarCache.set(cacheKey, { ts: Date.now(), data: priceMap });
  return priceMap;
}
