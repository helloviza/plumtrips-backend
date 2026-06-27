// ─────────────────────────────────────────────────────────────────────────────
// TBO Flight Service — Book & Ticket
// Based on TBO API Specification (Book + Ticket endpoints)
// ─────────────────────────────────────────────────────────────────────────────

import { httpFlight } from "../../lib/http.js";
import { getTBOToken} from "../../services/tbo/auths.services.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PassengerFare {
  BaseFare: number;
  Tax: number;
  TransactionFee: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
  AirTransFee: number;
}

export interface PassengerMeal {
  Code?: string;
  Description?: string;
}

export interface PassengerSeat {
  Code?: string;
  Description?: string;
}

export interface BookPassenger {
  Title: string;
  FirstName: string;
  LastName: string;
  PaxType: 1 | 2 | 3;                   // 1=Adult, 2=Child, 3=Infant
  DateOfBirth?: string;                  // Optional in Book; required in Ticket if not provided here
  Gender: 1 | 2;                         // 1=Male, 2=Female
  GSTCompanyAddress: string;
  GSTCompanyContactNumber: string;
  GSTCompanyName: string;
  GSTNumber: string;
  GSTCompanyEmail: string;
  PassportNo?: string;                   // Mandatory if IsPassportRequiredAtBook=true
  PassportExpiry?: string;               // Mandatory if IsPassportRequiredAtBook=true
  PassportIssueDate?: string;            // Mandatory if IsPassportFullDetailRequiredAtBook=true
  AddressLine1: string;
  AddressLine2?: string;
  City: string;
  CountryCode: string;
  CountryName: string;
  ContactNo: string;
  Email: string;
  IsLeadPax: boolean;
  FFAirlineCode?: string;
  FFNumber?: string;
  Fare: PassengerFare;
  Meal?: PassengerMeal;
  Seat?: PassengerSeat;
  Nationality: string;
  CellCountryCode?: string;             // Optional — prefixes ContactNo in response
}

// ─────────────────────────────────────────────────────────────────────────────
// Book
// ─────────────────────────────────────────────────────────────────────────────

export interface BookInput {
  EndUserIp?: string;                   // Resolved automatically if omitted
  TokenId?: string;                     // Resolved automatically if omitted
  traceId: string;
  resultIndex: string;
  passengers: BookPassenger[];
}

export interface BookResponse {
  IsPriceChanged: boolean;
  IsTimeChanged: boolean;
  SSRDenied: string;
  SSRMessage?: string;
  Status: string;
  FlightItinerary: {
    BookingId: number;
    PNR: string;
    IsDomestic: boolean;
    Source: string;
    Origin: string;
    Destination: string;
    AirlineCode: string;
    ValidatingAirlineCode: string;
    AirlineRemarks?: string;
    IsLCC: boolean;
    NonRefundable: boolean;
    FareType: string;
    Fare: Record<string, unknown>;
    Passenger: Record<string, unknown>[];
    Segments: Record<string, unknown>[];
    LastTicketDate: string;
    TicketAdvisory?: string;
    FareRules: Record<string, unknown>[];
  };
}

/**
 * bookFlight — Hold booking for Non-LCC airlines.
 *
 * Must be called before ticketFlight for Non-LCC.
 * Not applicable for LCC airlines (they are ticketed directly via ticketFlight).
 *
 * If IsPriceChanged or IsTimeChanged is true in the response, compare fares
 * on the client side and call bookFlight again with the updated fare.
 *
 * Passport details (PassportNo, PassportExpiry, PassportIssueDate) are optional
 * here but must be provided in ticketFlight if not supplied now.
 */
export async function bookFlight(input: BookInput): Promise<BookResponse> {
  const TokenId   = await getTBOToken(); 
  const EndUserIp = process.env.TBO_EndUserIp;

  const body = {
    EndUserIp,
    TokenId,
    TraceId:     input.traceId,
    ResultIndex: input.resultIndex,
    Passengers:  input.passengers,
  };

  const { data } = await httpFlight.post("/Book", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err?.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || `Book failed (ErrorCode ${err.ErrorCode})`);
  }

  return data.Response as BookResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket — Non-LCC
// ─────────────────────────────────────────────────────────────────────────────

export interface NonLCCPassportDetail {
  PaxId?: number;
  PassportNo?: string;
  PassportExpiry?: string;
  DateOfBirth: string;
}

export interface TicketNonLCCInput {
  EndUserIp?: string;
  TokenId?: string;
  TraceId: string;
  PNR: string;
  BookingId: number;
  Passport?: NonLCCPassportDetail[];    // Required if DOB/Passport not provided in Book
  IsPriceChangeAccepted?: boolean;      // Pass true if price changed and user accepted
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket — LCC
// ─────────────────────────────────────────────────────────────────────────────

export interface LCCPassengerBaggage {
  WayType: 0 | 1 | 2;                  // 0=NotSet, 1=Segment, 2=FullJourney
  Code: string;
  Description: string;
  Weight: string;
  Currency: string;
  Price: number;
  Origin: string;
  Destination: string;
}

export interface LCCPassengerMealDynamic {
  WayType: 0 | 1 | 2;
  Code: string;
  Description: string;
  AirlineDescription: string;
  Quantity: string;
  Price: number;
  Currency: string;
  Origin: string;
  Destination: string;
  Nationality: string;
}

export interface LCCPassengerFare {
  BaseFare: number;
  Tax: number;
  TransactionFee: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
  AirTransFee: number;
}

export interface LCCPassenger {
  Title: string;
  FirstName: string;
  LastName: string;
  PaxType: 1 | 2 | 3;
  DateOfBirth?: string;
  Gender: 1 | 2;
  PassportNo?: string;
  PassportExpiry?: string;
  AddressLine1: string;
  AddressLine2?: string;
  City: string;
  CountryCode: string;
  CountryName: string;
  ContactNo: string;
  Email: string;
  IsLeadPax: boolean;
  FFAirlineCode?: string;
  FFNumber?: string;
  GSTCompanyAddress: string;
  GSTCompanyContactNumber: string;
  GSTCompanyName: string;
  GSTNumber: string;
  GSTCompanyEmail: string;
  Fare: LCCPassengerFare;
  Baggage?: LCCPassengerBaggage[];
  MealDynamic?: LCCPassengerMealDynamic[];
}

export interface TicketLCCInput {
  EndUserIp?: string;
  TokenId?: string;
  TraceId: string;
  ResultIndex: string;
  Passengers: LCCPassenger[];
  IsPriceChangeAccepted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Ticket Response
// ─────────────────────────────────────────────────────────────────────────────

export interface TicketResponse {
  IsPriceChanged: boolean;
  IsTimeChanged: boolean;
  PNR: string;
  BookingId: number;
  SSRDenied: string;
  SSRMessage?: string;
  FlightItinerary: {
    BookingId: number;
    PNR: string;
    IsDomestic: boolean;
    Source: string;
    Origin: string;
    Destination: string;
    AirlineCode: string;
    ValidatingAirlineCode: string;
    AirlineRemarks?: string;
    IsLCC: boolean;
    NonRefundable: boolean;
    FareType: string;
    Fare: Record<string, unknown>;
    Passenger: Array<{
      PaxID: number;
      Title: string;
      FirstName: string;
      LastName: string;
      PaxType: number;
      DateOfBirth: string;
      Gender: string;
      PassportNo?: string;
      PassportExpiry?: string;
      Fare: Record<string, unknown>;
      Baggage?: Record<string, unknown>[];
      MealDynamic?: Record<string, unknown>;
      Ticket: {
        TicketId: number;
        TicketNumber: string;
        IssueDate: string;
        ValidatingAirline: string;
        Remarks: string;
        ServiceFeeDisplayType: string;
        Status: string;
      };
      SegmentAdditionalInfo: {
        FareBasis: string;
        NVA: string;
        NVB: string;
        Baggage: string;
        Meal: string;
      };
    }>;
    Segments: Record<string, unknown>[];
    FareRules: Record<string, unknown>[];
    InvoiceNo: string;
    InvoiceCreatedOn: string;
    GSTCompanyAddress: string;
    GSTCompanyContactNumber: string;
    GSTCompanyName: string;
    GSTNumber: string;
    GSTCompanyEmail: string;
  };
  TicketStatus:
    | 0   // Failed
    | 1   // Successful
    | 2   // NotSaved
    | 3   // NotCreated
    | 4   // NotAllowed
    | 5   // InProgress
    | 6   // TicketAlreadyCreated
    | 8   // PriceChanged
    | 9;  // OtherError
  Message?: string;
  Nationality: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ticketFlight — unified entry point for both LCC and Non-LCC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ticketFlight — Generate ticket for both LCC and Non-LCC.
 *
 * For Non-LCC: pass `nonLCC` with PNR + BookingId (obtained from bookFlight).
 *              Passport/DOB details required here if not provided in bookFlight.
 *
 * For LCC:     pass `lcc` with ResultIndex + full passenger details.
 *              LCC airlines are ticketed directly without a prior bookFlight call.
 *
 * Price change handling:
 *   - If IsPriceChanged=true in the response, compare on client side.
 *   - Call ticketFlight again with IsPriceChangeAccepted=true to confirm.
 *   - The ticket will be issued at the updated price.
 */
export async function ticketFlight(
  input:
    | { type: "nonLCC"; data: TicketNonLCCInput }
    | { type: "lcc";    data: TicketLCCInput }
): Promise<TicketResponse> {
  const TokenId   = await getTBOToken(); 
  const EndUserIp = process.env.TBO_EndUserIp;

  let body: Record<string, unknown>;

  if (input.type === "nonLCC") {
    const d = input.data as TicketNonLCCInput;

    if (!d.PNR)       throw new Error("PNR is required for Non-LCC ticketing");
    if (!d.BookingId) throw new Error("BookingId is required for Non-LCC ticketing");

    body = {
      EndUserIp,
      TokenId,
      TraceId:              d.TraceId,
      PNR:                  d.PNR,
      BookingId:            d.BookingId,
      ...(d.Passport?.length ? { Passport: d.Passport } : {}),
      IsPriceChangeAccepted: d.IsPriceChangeAccepted ?? false,
    };

  } else {
    const d = input.data as TicketLCCInput;

    if (!d.ResultIndex)           throw new Error("ResultIndex is required for LCC ticketing");
    if (!d.Passengers?.length)    throw new Error("Passengers are required for LCC ticketing");

    body = {
      EndUserIp,
      TokenId,
      TraceId:              d.TraceId,
      ResultIndex:          d.ResultIndex,
      Passengers:           d.Passengers,
      IsPriceChangeAccepted: d.IsPriceChangeAccepted ?? false,
    };
  }

  // ── Replace the httpFlight.post block at the bottom of ticketFlight ──

  let data: any;
  try {
    const res = await httpFlight.post("/Ticket", body, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    data = res.data;
  } catch (axiosErr: any) {
    // TBO returned non-2xx — expose the actual error body
    console.error("[ticketFlight] TBO HTTP status :", axiosErr?.response?.status);
    console.error("[ticketFlight] TBO error body  :", JSON.stringify(axiosErr?.response?.data, null, 2));
    console.error("[ticketFlight] Payload sent    :", JSON.stringify(body, null, 2));

    const tboMsg =
      axiosErr?.response?.data?.Response?.Error?.ErrorMessage ||
      axiosErr?.response?.data?.Message ||
      axiosErr?.message ||
      "Ticket request to TBO failed";
    throw new Error(tboMsg);
  }

  const response = data?.Response;

  console.log("[ticketFlight] TBO response:", JSON.stringify(response, null, 2));

  // Price changed — caller must re-invoke with IsPriceChangeAccepted: true
  if (response?.IsPriceChanged === true && !body.IsPriceChangeAccepted) {
    return response as TicketResponse;
  }

const err = response?.Error;
  if (err?.ErrorCode && err.ErrorCode !== 0) {
    console.error("[ticketFlight] TBO ErrorCode:", err.ErrorCode, err.ErrorMessage);
    if (err.ErrorCode === 2) {
      const pnrMatch = String(err.ErrorMessage ?? "").match(/PNR\s+([A-Z0-9]+)/i);
      const existingPnr = pnrMatch?.[1] ?? response?.PNR ?? "";
      console.warn("[ticketFlight] Treating ErrorCode 2 as already-created, PNR:", existingPnr);
      return {
        ...response,
        PNR:          existingPnr,
        TicketStatus: 6, // TicketAlreadyCreated
        Error:        { ErrorCode: 0, ErrorMessage: "" },
      } as TicketResponse;
    }

    throw new Error(err.ErrorMessage || `Ticket failed (ErrorCode ${err.ErrorCode})`);
  }

  return response as TicketResponse;
}