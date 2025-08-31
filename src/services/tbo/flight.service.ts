// apps/backend/src/services/tbo/flight.service.ts
import { httpFlight } from "../../lib/http.js";
import { authenticate, getEndUserIp } from "./auth.service.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SearchInput = {
  origin: string;
  destination: string;
  departDate: string;           // YYYY-MM-DD
  returnDate?: string;          // YYYY-MM-DD (omit for one-way)
  cabinClass?: number;          // 1=All, 2=Economy, 3=PremEco, 4=Business, 6=First
  adults?: number;
  children?: number;
  infants?: number;

  nonStopOnly?: boolean;        // -> DirectFlight
  oneStopOnly?: boolean;        // -> OneStopFlight
  preferredAirlines?: string[]; // e.g. ["AI","6E"]; empty => null
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
    cabinClass = 1,
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false,
    oneStopOnly = false,
    preferredAirlines = [],
  } = input || {};

  if (!origin || !destination || !departDate) {
    throw new Error("origin, destination, departDate are required");
  }

  const TokenId = await authenticate();
  const EndUserIp = getEndUserIp();

  const AdultCount  = String(adults);
  const ChildCount  = String(children);
  const InfantCount = String(infants);
  const JourneyType = returnDate ? "2" : "1";
  const DirectFlight  = nonStopOnly ? "true" : "false";
  const OneStopFlight = oneStopOnly ? "true" : "false";

  const Segments = [
    {
      Origin: upper(origin),
      Destination: upper(destination),
      FlightCabinClass: String(cabinClass),
      PreferredDepartureTime: `${departDate}T00:00:00`,
      PreferredArrivalTime:   `${departDate}T00:00:00`,
    },
  ];

  if (returnDate) {
    Segments.push({
      Origin: upper(destination),
      Destination: upper(origin),
      FlightCabinClass: String(cabinClass),
      PreferredDepartureTime: `${returnDate}T00:00:00`,
      PreferredArrivalTime:   `${returnDate}T00:00:00`,
    });
  }

  const body = {
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
    Sources: null,
  };

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
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
