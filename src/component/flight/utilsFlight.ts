import { authenticate} from "../../services/tbo/auth.service.js";
import { httpFlight } from "../../lib/http.js";
import type {RawSearchParams,PriceRBDParams} from "./flightComponent.js";


// ─── Shared helpers ────────────────────────────────────────────────────────────

export const upper = (s: string) => String(s || "").trim().toUpperCase();
export const TBO_ANY_TIME = "00:00:00";

/** Attach auth fields to any TBO request body. */
async function withAuth<T extends object>(body: T) {
  const TokenId   = await authenticate();
  const EndUserIp = process.env.TBO_EndUserIp;
  return { EndUserIp, TokenId, ...body };
}

/** Throw if the TBO response carries a non-zero error code. */
function assertNoTBOError(err: { ErrorCode?: number; ErrorMessage?: string } | undefined, label: string) {
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new Error(err.ErrorMessage || `${label} failed (ErrorCode ${err.ErrorCode})`);
  }
}

// ─── POST /Search ──────────────────────────────────────────────────────────────


export async function rawSearch(params: RawSearchParams) {
  const body = await withAuth<RawSearchParams & { Sources?: never }>({
    ...params,
    // Sources intentionally omitted — TBO uses account defaults.
  });

  console.log("[rawSearch] TokenId:", body.TokenId ? `${String(body.TokenId).slice(0, 8)}…` : "(empty)");
  console.log("[rawSearch] EndUserIp:", body.EndUserIp);
  console.log("[rawSearch] TBO request body:", JSON.stringify(body, null, 2));

  const { data } = await httpFlight.post("/Search", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  console.log(
    "[rawSearch] status:", data?.Response?.ResponseStatus,
    "ErrorCode:", data?.Response?.Error?.ErrorCode,
    "ErrorMessage:", data?.Response?.Error?.ErrorMessage,
  );

  return data;
}

// ─── POST /FareRule ────────────────────────────────────────────────────────────

export interface FareRuleParams {
  traceId:     string;
  resultIndex: string | number;
}

export async function rawFareRule({ traceId, resultIndex }: FareRuleParams) {
  const body = await withAuth({
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
  });

  const { data } = await httpFlight.post("/FareRule", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  assertNoTBOError(data?.Response?.Error, "FareRule");
  return data;
}

// ─── POST /FareQuote ───────────────────────────────────────────────────────────

export interface FareQuoteParams {
  traceId:     string;
  resultIndex: string | number;
}

export async function rawFareQuote({ traceId, resultIndex }: FareQuoteParams) {
  const body = await withAuth({
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
  });

  const { data } = await httpFlight.post("/FareQuote", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  const err = data?.Response?.Error;
  if (err && err.ErrorCode && err.ErrorCode !== 0) {
    const msg = err.ErrorMessage || "";
    const isSession =
      err.ErrorCode === 6 ||
      msg.toLowerCase().includes("session") ||
      msg.toLowerCase().includes("traceid") ||
      msg.toLowerCase().includes("expired");

    // if (isSession) {
    //   invalidateToken();
    //   throw new Error("SESSION_EXPIRED");
    // }
    throw new Error(msg || "FareQuote failed");
  }

  return data;
}

// ─── POST /PriceRBD ────────────────────────────────────────────────────────────



export async function rawPriceRBD(params: PriceRBDParams) {
  const body = await withAuth({
    TraceId:         String(params.traceId),
    AdultCount:      params.adultCount,
    ChildCount:      params.childCount,
    InfantCount:     params.infantCount,
    AirSearchResult: params.airSearchResult,
  });

  const { data } = await httpFlight.post("/PriceRBD", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  assertNoTBOError(data?.Response?.Error, "PriceRBD");
  return data;
}

// ─── POST /SSR ─────────────────────────────────────────────────────────────────

export interface SSRParams {
  traceId:     string;
  resultIndex: string | number;
}



// And update rawSSR() to use withAuth like rawFareQuote does:
export async function rawSSR({ traceId, resultIndex }: SSRParams) {
  const body = await withAuth({
    TraceId:     String(traceId),
    ResultIndex: resultIndex,
  });

  console.log("[rawSSR] Calling /SSR with ResultIndex:", resultIndex);

  const { data } = await httpFlight.post("/SSR", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  return data;
}


//Multicity

export function isMultiCityTrip(body: any): boolean {
  return (
    body?.tripType === "multiCity" &&
    Array.isArray(body?.segments) &&
    body.segments.length >= 2
  );
}




///Cancellation Params

export interface CancellationParams {
  bookingId: number;
  source: string;
}

export async function rawCancellation(params: CancellationParams) {
  const body = await withAuth({
    BookingId: Number(params.bookingId),  // ✅ PascalCase
    Source:    String(params.source),     // ✅ PascalCase
  });

  console.log("[rawCancellation] Request body:", JSON.stringify(body, null, 2));

  const { data } = await httpFlight.post("/ReleasePNRRequest", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  console.log("[rawCancellation] TBO response:", JSON.stringify(data, null, 2));

  assertNoTBOError(data?.Response?.Error, "ReleasePNRRequest");
  return data;
}