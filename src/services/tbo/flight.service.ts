// apps/backend/src/services/tbo/flight.service.ts
import { httpFlight } from "../../lib/http.js";
import { authenticate, getEndUserIp } from "./auth.service.js";
import airports from "../../data/airports.json" ;
import airlines from "../../data/airlines.json" ;

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
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchFlights(input: SearchInput) {
  const {
    origin, destination, departDate, returnDate,
    tripType,
    segments: multiSegments,
    // Default cabin to 2 (Economy). TBO treats 1 (All) as unresolvable
    // and returns no results for many routes.
    cabinClass = 2,
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false,
    oneStopOnly = false,
    preferredAirlines = [],
    fareType,
  } = input || {};

  // Multi-city: require segments array with at least 2 legs
  const isMultiCity =
    tripType === "multiCity" &&
    Array.isArray(multiSegments) &&
    multiSegments.length >= 2;

  if (!isMultiCity && (!origin || !destination || !departDate)) {
    throw new Error("origin, destination, departDate are required");
  }

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  // TBO's JSON deserializer is strict — use native number/boolean types,
  // NOT strings. "1" !== 1 and "false" !== false.
  const AdultCount    = Number(adults);
  const ChildCount    = Number(children);
  const InfantCount   = Number(infants);
  const DirectFlight  = Boolean(nonStopOnly);
  const OneStopFlight = Boolean(oneStopOnly);

  // ── Build Segments ────────────────────────────────────────────────
  // KEY RULE: Both PreferredDepartureTime and PreferredArrivalTime must use
  // one of TBO's 5 allowed values. "00:00:00" = AnyTime (no restriction).
  // Format: "YYYY-MM-DDT00:00:00" — date portion comes from the leg date.

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

  // ── Build Request Body ────────────────────────────────────────────
  // IMPORTANT: Do NOT send `Sources: null`. Sending null Sources causes
  // some TBO tenant configs to treat it as "no source authorized" and
  // return ErrorCode 3 or 25. Omit the field entirely so TBO uses the
  // defaults configured for your account.
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
    // If your TBO account requires explicit source IDs, add:
    //   Sources: ["WEB_FARE", "LCC"],  // replace with your authorized source IDs
  };

  // Forward fareType to TBO only when non-Regular, so TBO applies the
  // right fare rules (Student, ArmedForces, SeniorCitizen).
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
    // ErrorCode 6  = "No Fare Available" — valid empty result
    // ErrorCode 25 = "No Result Found"   — valid empty result
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
    // All other non-zero codes are real failures — surface the TBO message
    throw new Error(err.ErrorMessage || `TBO Search failed (ErrorCode ${err.ErrorCode})`);
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

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId: String(traceId),
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

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId: String(traceId),
    ResultIndex: resultIndex,
  };

  const { data } = await httpFlight.post("/FareQuote", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "FareQuote failed");
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Book / Ticket / GetBookingDetails                                   */
/* ------------------------------------------------------------------ */

export async function bookFlight(input: BookInput) {
  const {
    traceId, resultIndex,
    passengers,
    contact, address, gst,
    isLCC = false, blockedFare = false,
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

  const fq = await getFareQuote({ traceId, resultIndex });
  const fqRes = fq?.Response?.Results;
  if (!fqRes) throw new Error("FareQuote missing Results");

  const fareByPaxType = new Map<number, any>();
  for (const bd of fqRes.FareBreakdown || []) {
    if (typeof bd?.PassengerType === "number") {
      fareByPaxType.set(bd.PassengerType, bd);
    }
  }

  const overallFare = fqRes.Fare || {};
  const defaultCurrency = overallFare.Currency || "INR";

  const passengersWithFare = passengers.map((p) => {
    const bd = fareByPaxType.get(p.PaxType);
    if (!bd) throw new Error(`FareQuote missing FareBreakdown for PaxType ${p.PaxType}`);

    const fare = {
      Currency: bd.Currency || defaultCurrency,
      BaseFare: bd.BaseFare,
      Tax: bd.Tax,
      YQTax: bd.YQTax ?? overallFare.YQTax ?? 0,
      AdditionalTxnFeeOfrd: overallFare.AdditionalTxnFeeOfrd ?? 0,
      AdditionalTxnFeePub: overallFare.AdditionalTxnFeePub ?? 0,
      PGCharge: overallFare.PGCharge ?? 0,
      OtherCharges: overallFare.OtherCharges ?? 0,
      ServiceFee: overallFare.ServiceFee ?? 0,
    };

    const paxAddress: Record<string, any> = {};
    if (address?.AddressLine1) paxAddress.AddressLine1 = address.AddressLine1;
    if (address?.AddressLine2) paxAddress.AddressLine2 = address.AddressLine2;
    if (address?.City) paxAddress.City = address.City;
    if (address?.CountryCode) paxAddress.CountryCode = address.CountryCode;

    return { ...p, Fare: fare, ...paxAddress };
  });

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    TraceId: String(traceId),
    ResultIndex: resultIndex,
    Passengers: passengersWithFare,
    Address: {
      AddressLine: address?.AddressLine || address?.AddressLine1 || "N/A",
      City: address?.City || "Delhi",
      CountryCode: address?.CountryCode || "IN",
      ZipCode: address?.ZipCode || "110001",
    },
    Contact: {
      Email: contact.Email,
      Mobile: contact.Mobile,
    },
    GSTCompanyAddress: gst?.GSTCompanyAddress || "",
    GSTCompanyContactNumber: gst?.GSTCompanyContactNumber || "",
    GSTCompanyName: gst?.GSTCompanyName || "",
    GSTNumber: gst?.GSTNumber || "",
    GSTCompanyEmail: gst?.GSTCompanyEmail || "",
    IsLCC: Boolean(isLCC),
    BlockedFare: Boolean(blockedFare),
  };

  const { data } = await httpFlight.post("/Book", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "Book failed");
  }

  return data;
}

export async function ticketFlight(input: {
  bookingId: number | string;
  pnr?: string;
  traceId?: string;
}) {
  const { bookingId, pnr = "", traceId } = input || {};
  if (!bookingId) throw new Error("bookingId is required");

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const body: any = {
    EndUserIp,
    TokenId,
    BookingId: Number(bookingId),
    PNR: String(pnr || ""),
  };
  if (traceId) body.TraceId = String(traceId);

  const { data } = await httpFlight.post("/Ticket", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "Ticket failed");
  }
  return data;
}

export async function getBookingDetails(input: { bookingId: number | string }) {
  const { bookingId } = input || {};
  if (!bookingId) throw new Error("bookingId is required");

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const body = {
    EndUserIp,
    TokenId,
    BookingId: Number(bookingId),
  };

  const { data } = await httpFlight.post("/GetBookingDetails", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || "GetBookingDetails failed");
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