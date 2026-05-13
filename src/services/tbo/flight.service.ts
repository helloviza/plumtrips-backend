// apps/backend/src/services/tbo/flight.service.ts
import { httpFlight } from "../../lib/http.js";
import { authenticate, getEndUserIp } from "./auth.service.js";

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
  // FIX #2: fareType now accepted so it can be forwarded to TBO
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

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchFlights(input: SearchInput) {
  const {
    origin, destination, departDate, returnDate,
    tripType,
    segments: multiSegments,
    // FIX #3: Default cabin to 2 (Economy), NOT 1 (All).
    // TBO treats "All" as an unresolvable cabin and returns no results.
    cabinClass = 2,
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false,
    oneStopOnly = false,
    preferredAirlines = [],
    fareType,
  } = input || {};

  // Multi-city: require segments array
  const isMultiCity = tripType === "multiCity" && Array.isArray(multiSegments) && multiSegments.length >= 2;

  if (!isMultiCity && (!origin || !destination || !departDate)) {
    throw new Error("origin, destination, departDate are required");
  }

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  // FIX #1: Use native number/boolean types — NOT strings.
  // TBO's JSON deserializer is strict: "1" !== 1 and "false" !== false.
  // Sending strings for these fields causes TBO to fail parsing the request
  // and return ErrorCode 25 ("No Result Found") even for valid routes.
  const AdultCount  = Number(adults);
  const ChildCount  = Number(children);
  const InfantCount = Number(infants);
  const DirectFlight   = Boolean(nonStopOnly);
  const OneStopFlight  = Boolean(oneStopOnly);

  let JourneyType: number;
  let Segments: {
    Origin: string;
    Destination: string;
    FlightCabinClass: number;     // FIX #1: number, not string
    PreferredDepartureTime: string;
    PreferredArrivalTime: string;
  }[];

  if (isMultiCity) {
    // ── Multi-city: JourneyType 3, one segment per leg ──
    JourneyType = 3;              // FIX #1: number literal
    Segments = multiSegments!.map((seg) => ({
      Origin: upper(seg.origin),
      Destination: upper(seg.destination),
      FlightCabinClass: cabinClass,          // FIX #1: number
      PreferredDepartureTime: `${seg.departDate}T00:00:00`,
      // FIX #6: Use end-of-day for arrival so overnight-arriving flights are included
      PreferredArrivalTime: `${seg.departDate}T00:00:00`,
    }));
  } else if (returnDate) {
    // ── Round trip: JourneyType 2 ──
    JourneyType = 2;              // FIX #1: number literal
    Segments = [
      {
        Origin: upper(origin),
        Destination: upper(destination),
        FlightCabinClass: cabinClass,        // FIX #1: number
        PreferredDepartureTime: `${departDate}T00:00:00`,
        // FIX #6: end-of-day so next-day arrivals on long routes aren't filtered out
        PreferredArrivalTime: `${departDate}T00:00:00`,
      },
      {
        Origin: upper(destination),
        Destination: upper(origin),
        FlightCabinClass: cabinClass,        // FIX #1: number
        PreferredDepartureTime: `${returnDate}T00:00:00`,
        PreferredArrivalTime: `${returnDate}T00:00:00`,
      },
    ];
  } else {
    // ── One-way: JourneyType 1 ──
    JourneyType = 1;              // FIX #1: number literal
    Segments = [
      {
        Origin: upper(origin),
        Destination: upper(destination),
        FlightCabinClass: cabinClass,        // FIX #1: number
        PreferredDepartureTime: `${departDate}T00:00:00`,
        PreferredArrivalTime: `${departDate}T00:00:00`,
      },
    ];
  }

  const body: Record<string, unknown> = {
    EndUserIp,
    TokenId,
    AdultCount,    // FIX #1: number
    ChildCount,    // FIX #1: number
    InfantCount,   // FIX #1: number
    DirectFlight,  // FIX #1: boolean
    OneStopFlight, // FIX #1: boolean
    JourneyType,   // FIX #1: number
    PreferredAirlines: preferredAirlines.length ? preferredAirlines : null,
    Segments,
    Sources: null,
  };

  // FIX #2: Forward fareType to TBO when provided.
  // Without this, special-fare searches (Student, ArmedForces, SeniorCitizen)
  // were silently dropped and TBO returned no results for those fare types.
  if (fareType && fareType !== "Regular") {
    body.FareType = fareType;
  }

  console.log("[searchFlights] TokenId:", TokenId ? `${String(TokenId).slice(0, 8)}…` : "(empty)");
  console.log("[searchFlights] EndUserIp:", EndUserIp);
  console.log("[searchFlights] TBO request body:", JSON.stringify(body, null, 2));

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  console.log("[searchFlights] TBO raw response status:", data?.Response?.ResponseStatus, "ErrorCode:", data?.Response?.Error?.ErrorCode);

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    // ErrorCode 6  = "No Fare Available" — valid empty result, not a real error
    // ErrorCode 25 = "No Result Found"   — valid empty result, not a real error
    if (err.ErrorCode === 6 || err.ErrorCode === 25) {
      console.log("[searchFlights] No flights found (ErrorCode", err.ErrorCode + ") — returning empty results");
      return {
        Response: {
          // FIX #4: Use ResponseStatus 1 (success/empty) instead of 2 (failure)
          // so the frontend can correctly distinguish "no flights" from a real error.
          ResponseStatus: 1,
          Error: { ErrorCode: 0, ErrorMessage: "" },
          TraceId: data?.Response?.TraceId ?? "",
          Results: [],
          NoResultReason: err.ErrorMessage || "No flights found for this route/date",
        },
      };
    }
    // All other error codes are real failures
    throw new Error(err.ErrorMessage || "Search failed");
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

export async function ticketFlight(input: { bookingId: number | string; pnr?: string; traceId?: string }) {
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
/* Airports                                                            */
/* ------------------------------------------------------------------ */

export type Airport = {
  code: string;
  city: string;
  name: string;
  country?: string;
};

/**
 * Returns the curated static airport list.
 * Later: swap this for a real TBO SharedData / /api/v1/sharedData/Airport call.
 */
export function getAirports(): Airport[] {
  return [
    { code: "DEL", city: "New Delhi", name: "Indira Gandhi International" },
    { code: "BOM", city: "Mumbai", name: "Chhatrapati Shivaji Maharaj International" },
    { code: "BLR", city: "Bengaluru", name: "Kempegowda International" },
    { code: "HYD", city: "Hyderabad", name: "Rajiv Gandhi International" },
    { code: "MAA", city: "Chennai", name: "Chennai International" },
    { code: "CCU", city: "Kolkata", name: "Netaji Subhas Chandra Bose International" },
    { code: "GOI", city: "Goa", name: "Goa International" },
    { code: "AMD", city: "Ahmedabad", name: "Sardar Vallabhbhai Patel International" },
    { code: "PNQ", city: "Pune", name: "Pune International" },
    { code: "JAI", city: "Jaipur", name: "Jaipur International" },
    { code: "LKO", city: "Lucknow", name: "Chaudhary Charan Singh International" },
    { code: "PAT", city: "Patna", name: "Jay Prakash Narayan International" },
    { code: "IXC", city: "Chandigarh", name: "Shaheed Bhagat Singh International" },
    { code: "ATQ", city: "Amritsar", name: "Sri Guru Ram Dass Jee International" },
    { code: "COK", city: "Kochi", name: "Cochin International" },
    { code: "TRV", city: "Trivandrum", name: "Trivandrum International" },
    { code: "NAG", city: "Nagpur", name: "Dr. Babasaheb Ambedkar International" },
    { code: "BHO", city: "Bhopal", name: "Raja Bhoj International" },
    { code: "BBI", city: "Bhubaneswar", name: "Biju Patnaik International" },
    { code: "GAU", city: "Guwahati", name: "Lokpriya Gopinath Bordoloi International" },
    { code: "BKK", city: "Bangkok", name: "Suvarnabhumi International", country: "Thailand" },
    { code: "DXB", city: "Dubai", name: "Dubai International", country: "UAE" },
    { code: "SIN", city: "Singapore", name: "Changi International", country: "Singapore" },
    { code: "LHR", city: "London", name: "Heathrow", country: "UK" },
    { code: "NRT", city: "Tokyo", name: "Narita International", country: "Japan" },
    { code: "CDG", city: "Paris", name: "Charles de Gaulle", country: "France" },
    { code: "JFK", city: "New York", name: "John F. Kennedy International", country: "USA" },
    { code: "AUH", city: "Abu Dhabi", name: "Zayed International", country: "UAE" },
    { code: "KUL", city: "Kuala Lumpur", name: "Kuala Lumpur International", country: "Malaysia" },
    { code: "SYD", city: "Sydney", name: "Kingsford Smith International", country: "Australia" },
  ];
}