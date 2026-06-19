const NDC_AIRLINE_CODES = new Set(["EK", "LH", "BA", "SQ", "WY", "EY", "GF"]);
export function isNDCFlight(airlineCode: string, isNDCFlag?: boolean): boolean {
  return NDC_AIRLINE_CODES.has(airlineCode) || isNDCFlag === true;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SearchSegment = {
  origin: string;
  destination: string;
  departDate: string;   
          // YYYY-MM-DD
  cabinClass?: number;    // 1=All, 2=Economy, 3=PremEco, 4=Business, 5=First
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



