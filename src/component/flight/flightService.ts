import {isMultiCityTrip,rawFareQuote,rawFareRule,rawPriceRBD,rawCancellation} from "./utilsFlight.js";
import {searchMultiCityAsOneWay, searchFlights,} from "./flightSearch.js";
import { getTBOToken} from "../../services/tbo/auths.services.js";
import { httpFlight } from "../../lib/http.js";
import type {FareQuoteParams, FareRuleParams, SSRParams,CancellationParams} from "./utilsFlight.js";
import type {PriceRBDParams} from "./flightComponent.js";



export async function handleSearchController(body: any): Promise<{
  ok: boolean;
  data?: any;
  message?: string;
  tboError?: any;
}> {
  try {
    if (isMultiCityTrip(body)) {
      const data = await searchMultiCityAsOneWay(body);
      console.log("[search] ✅ multiCity success, legs:", data.legs.length);
      return { ok: true, data };
    }

    const data = await searchFlights(body);
    console.log("[search] ✅ success, TraceId:", data?.Response?.TraceId);
    return { ok: true, data };

  } catch (e: any) {
    const tboData = e?.response?.data;
    console.error("[search] ❌ ERROR:", {
      message: e.message,
      status: e?.response?.status,
      tboResponse: tboData ? JSON.stringify(tboData).slice(0, 500) : "(no response data)",
    });
    return {
      ok: false,
      message: e.message,
      tboError: tboData?.Response?.Error ?? null,
    };
  }
}


export async function getFareRule(input: FareRuleParams) {
  if (!input.traceId || input.resultIndex === undefined || input.resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }
  return rawFareRule(input);
}





/** Retrieve a live fare quote for a result. */
export async function getFareQuote(input: FareQuoteParams) {
  if (!input.traceId || input.resultIndex === undefined || input.resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }
  return rawFareQuote(input);
}



/** Price by RBD (booking class). */
export async function getPriceRBD(params: PriceRBDParams) {
  return rawPriceRBD(params);
}



/** Fetch SSR options for a result. */
export async function getSSR(input: SSRParams & {
  skipFareQuote?: boolean;
  allResultIndexes?: string[];
}) {
  const { traceId, resultIndex, skipFareQuote = false } = input;
  // allResultIndexes is no longer used — each leg is called individually

  if (!traceId || resultIndex === undefined || resultIndex === null) {
    throw new Error("traceId and resultIndex are required");
  }

  const TokenId   = await getTBOToken();
  const EndUserIp = process.env.TBO_EndUserIp;

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
    // if (msg.toLowerCase().includes("session") || msg.toLowerCase().includes("expired")) {
    //   invalidateToken();
    // }
    return err.ErrorCode === 6 || err.ErrorCode === 25
      ? { Response: { SSR: [] } }
      : { Response: { SSR: [], Error: { ErrorCode: err.ErrorCode, ErrorMessage: msg } } };
  }

  return data;
}


export async function cancelPNR(params: CancellationParams) {
  if (!params.bookingId) {
    throw new Error("bookingId is required");
  }
  if (!params.source) {
    throw new Error("source is required");
  }
  return rawCancellation(params);
}