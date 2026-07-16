// apps/backend/src/routes/flights/index.ts
import { Router } from "express";
import crypto from "crypto";

import { generateTicketPdf } from "../../component/flight/TicketPDF.js";

import {
  ticketLCC,
  getBookingDetails,
  getAirports,
  getAirlines,
  getCalendarPrices,
  
} from "../../services/tbo/flight.service.js";


import { bookFlight,ticketFlight } from "../../component/flight/flightBookTicket.js";

import { 
  getFareRule,
  getFareQuote,
  getSSR,cancelPNR,cancelPNRSend} from "../../component/flight/flightService.js";



import {
  authenticate,
  _authBodyForDebug,
} from "../../services/tbo/auth.service.js";

import {
  httpShared,
  httpFlight,
  SHARED_BASE,
  FLIGHT_BASE,
  axiosMessage,
  withTimeout,
} from "../../lib/http.js";

import {handleSearchController} from "../../component/flight/flightService.js";
    const { BookingModel } = await import("../../models/booking.model.js");

const r = Router();

const ok   = (data: any)                        => ({ ok: true, data });
const fail = (message: string, extra: any = {}) => ({ ok: false, message, ...extra });

/* ------------------------------------------------------------------ */
/* Auth diagnostics                                                    */
/* ------------------------------------------------------------------ */

r.get("/tbo/_auth-debug", async (_req, res) => {
  try {
    const token = await authenticate();
    res.json(
      ok({
        tokenPreview: token ? `${String(token).slice(0, 8)}…` : "(no token)",
        sharedBase: SHARED_BASE,
        flightBase: FLIGHT_BASE,
        body: _authBodyForDebug(true),
      })
    );
  } catch (e: any) {
    res.status(400).json(
      fail(axiosMessage(e), {
        sharedBase: SHARED_BASE,
        flightBase: FLIGHT_BASE,
        body: _authBodyForDebug(true),
      })
    );
  }
});

r.get("/tbo/_auth-raw", async (_req, res) => {
  try {
    const { data, status } = await httpShared.post(
      "/Authenticate",
      _authBodyForDebug(false),
      withTimeout(60_000)
    );
    res.status(status || 200).json(data);
  } catch (e: any) {
    const status = e?.response?.status || 500;
    res.status(status).json(e?.response?.data || { message: axiosMessage(e) });
  }
});

r.post("/tbo/_search-raw", async (req, res) => {
  try {
    const token = await authenticate();
    const { EndUserIp } = _authBodyForDebug(false);

    const {
      origin,
      destination,
      departDate,
      returnDate,
      cabinClass = 1,
      adults = 1,
      children = 0,
      infants = 0,
      sources = null,
      nonStopOnly = false,
      oneStopOnly = false,
      preferredAirlines = [],
    } = req.body || {};

    if (!origin || !destination || !departDate) {
      return res.status(400).json(fail("origin, destination, departDate are required"));
    }

    const seg = (date: string, o: string, d: string) => ({
      Origin: String(o || "").toUpperCase(),
      Destination: String(d || "").toUpperCase(),
      FlightCabinClass: String(cabinClass),
      PreferredDepartureTime: `${date}T00:00:00`,
      PreferredArrivalTime:   `${date}T00:00:00`,
    });

    const Segments: any[] = [seg(departDate, origin, destination)];
    const JourneyType = returnDate ? "2" : "1";
    if (returnDate) Segments.push(seg(returnDate, destination, origin));

    const body = {
      EndUserIp,
      TokenId: token,
      AdultCount:        String(adults),
      ChildCount:        String(children),
      InfantCount:       String(infants),
      DirectFlight:      nonStopOnly ? "true" : "false",
      OneStopFlight:     oneStopOnly ? "true" : "false",
      JourneyType,
      PreferredAirlines:
        Array.isArray(preferredAirlines) && preferredAirlines.length
          ? preferredAirlines
          : null,
      Segments,
      Sources: sources && Array.isArray(sources) && sources.length ? sources : null,
    };

    const { data, status } = await httpFlight.post("/Search", body);
    res.status(status || 200).json(data);
  } catch (e: any) {
    res
      .status(e?.response?.status || 500)
      .json(e?.response?.data || { message: axiosMessage(e) });
  }
});

/* ------------------------------------------------------------------ */
/* Core Flight endpoints                                               */
/* ------------------------------------------------------------------ */






r.post("/tbo/search", async (req, res) => {
  console.log("[tbo/search] incoming body:", JSON.stringify(req.body, null, 2));
  const result = await handleSearchController(req.body);
  const status = result.ok ? 200 : 400;
  res.status(status).json(result);
});



r.post("/tbo/fare-rule", async (req, res) => {
  try {
    const data = await getFareRule(req.body);
    res.json(ok(data));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e)));
  }
});




r.post("/tbo/fare-quote", async (req, res) => {
  try {
    const data = await getFareQuote(req.body);
    res.json(ok(data));
  } catch (e: any) {
    const msg = axiosMessage(e);
    if (msg === "SESSION_EXPIRED") {
      return res.status(410).json(fail("Your search has expired. Please search again for updated fares."));
    }
    res.status(400).json(fail(msg));
  }
});


r.post("/tbo/ssr", async (req, res) => {
  try {
    // skipFareQuote: true — the frontend always runs apiFareQuote before calling
    // this endpoint and sends the fare-quoted ResultIndex. Running fareQuote again
    // here creates a new TBO session which invalidates the SSR state,
    // causing TBO ErrorCode 27 "No SSR details found."
    const data = await getSSR({
      traceId:       req.body.traceId,
      resultIndex:   req.body.resultIndex,
      skipFareQuote: true,
    });
    const ssrError = data?.Response?.Error;
    if (ssrError?.ErrorCode && ssrError.ErrorCode !== 0) {
      return res.status(502).json(
        fail(ssrError.ErrorMessage || "SSR options could not be loaded", {
          tboError: ssrError,
        })
      );
    }
    res.json(ok(data));
  } catch (e: any) {
    console.warn("[tbo/ssr] SSR fetch threw:", axiosMessage(e));
    res.status(502).json(fail(axiosMessage(e)));
  }
});




// r.post("/tbo/book", async (req, res) => {
//   try {
//     console.log("[/tbo/book] Incoming request body:", JSON.stringify(req.body, null, 2));
//     const data = req.body?.isLCC === true
//       ? await ticketLCC(req.body)
//       : await bookFlight(req.body);
//     res.json(ok(data));
//   } catch (e: any) {
//     const errMsg = axiosMessage(e);
//     console.error("[/tbo/book] Error:", errMsg);
//     console.error("[/tbo/book] Full error:", e);
//     res.status(400).json(fail(errMsg));
//   }
// });



// r.post("/tbo/ticket", async (req, res) => {
//   try {
//     const data = req.body?.isLCC === true
//       ? await ticketLCC(req.body)
//       : await ticketFlight(req.body);
//     res.json(ok(data));
//   } catch (e: any) {
//     res.status(400).json(fail(axiosMessage(e)));
//   }
// });



r.post("/tbo/booking-save", async (req, res) => {
  try {
    const { bookingId, pnr, contactEmail, contactPhone, totalPaid,
            flightItinerary, passengers, fare, segments, rawResponse } = req.body;

    if (!bookingId || !pnr || !contactEmail) {
      return res.status(400).json(fail("bookingId, pnr, and contactEmail are required"));
    }



    const booking = await BookingModel.findOneAndUpdate(
      { bookingId },
      { bookingId, pnr, contactEmail, contactPhone, totalPaid,
        flightItinerary, passengers, fare, segments, rawResponse },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(ok({ saved: true, id: booking._id }));
  } catch (e: any) {
    res.status(500).json(fail(e.message || "Failed to save booking"));
  }
});

r.get("/tbo/booking/:bookingId", async (req, res) => {
  try {
    const { BookingModel } = await import("../../models/booking.model.js");
    const booking = await BookingModel.findOne({ bookingId: Number(req.params.bookingId) });
    if (!booking) return res.status(404).json(fail("Booking not found"));
    res.json(ok(booking));
  } catch (e: any) {
    res.status(500).json(fail(e.message));
  }
});


r.post("/tbo/booking-details", async (req, res) => {
  try {
    const data = await getBookingDetails(req.body);
    res.json(ok(data));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e)));
  }
});



/* ------------------------------------------------------------------ */
/* Calendar Prices                                                     */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/flights/calendar-prices?from=DEL&to=BOM&cabinClass=2
 *
 * Returns a map of { "YYYY-MM-DD": lowestFareINR } for the next 60 days.
 * Used by the frontend CalendarPopup to show per-date price hints.
 *
 * Query params:
 *   from        — IATA origin code        (required)
 *   to          — IATA destination code   (required)
 *   cabinClass  — TBO cabin class number  (optional, default 2 = Economy)
 */
r.get("/calendar-prices", async (req, res) => {
  try {
    const from       = String(req.query.from       || "").toUpperCase().trim();
    const to         = String(req.query.to         || "").toUpperCase().trim();
    const cabinClass = Number(req.query.cabinClass  || 2);
    const daysAhead  = Number(req.query.daysAhead || 62);

    if (!from || !to) {
      return res.status(400).json(fail("Query params 'from' and 'to' are required"));
    }
    if (from === to) {
      return res.status(400).json(fail("'from' and 'to' must be different airports"));
    }

    console.log(`[calendar-prices] Fetching prices for ${from}→${to} cabinClass=${cabinClass}`);

    const priceMap = await getCalendarPrices({ from, to, cabinClass, daysAhead });

    console.log(
      `[calendar-prices] ✅ Returning ${Object.keys(priceMap).length} dates for ${from}→${to}`
    );

    res.json(ok(priceMap));
  } catch (e: any) {
    console.error("[calendar-prices] ❌ error:", e.message);
    res.status(500).json(fail(e.message || "Failed to fetch calendar prices"));
  }
});

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

r.get("/tbo/health", async (_req, res) => {
  let tokenOk = false;
  try {
    const token = await authenticate();
    tokenOk = typeof token === "string" && token.length > 0;
  } catch {
    tokenOk = false;
  }
  res.json(ok({ tokenOk, flightBase: FLIGHT_BASE }));
});

/* ------------------------------------------------------------------ */
/* Airport / Airline lists                                             */
/* ------------------------------------------------------------------ */

r.get("/tbo/airports", (_req, res) => {
  res.json(ok(getAirports()));
});

r.get("/tbo/airlines", (_req, res) => {
  res.json(ok(getAirlines()));
});





r.post("/tbo/book", async (req, res) => {
  try {
    if (req.body?.isLCC === true) {
      return res.status(400).json(fail("LCC flights do not use /book."));
    }

    const { traceId, resultIndex, passengers, contact, gst } = req.body;
    const hasGST = !!gst?.GSTNumber?.trim();

    const enrichedPassengers = (passengers ?? []).map((p: any) => {
      const fare = p.Fare ?? p.fare;
      const safeFare = fare ? {
        BaseFare:             Math.max(0, fare.BaseFare ?? 0),
        Tax:                  Math.max(0, fare.Tax      ?? 0),
        TransactionFee:       0,
        YQTax:                0,
        AdditionalTxnFeeOfrd: 0,
        AdditionalTxnFeePub:  0,
        AirTransFee:          0,
      } : undefined;

      return {
        ...p,
        Nationality:             p.Nationality || "IN",
        GSTNumber:               hasGST ? gst.GSTNumber                                   : "",
        GSTCompanyName:          hasGST ? (gst.GSTCompanyName    || "")                   : "",
        GSTCompanyAddress:       hasGST ? (gst.GSTCompanyAddress || "")                   : "",
        GSTCompanyContactNumber: hasGST ? (contact?.Mobile       || "")                   : "",
        GSTCompanyEmail:         hasGST ? (gst.GSTCompanyEmail   || contact?.Email || "") : "",
        ...(safeFare ? { Fare: safeFare } : {}),
      };
    });

    // ── TEMP DEBUG ───────────────────────────────────────────
    console.log("[/tbo/book] Enriched passengers being sent:");
    console.log(JSON.stringify(enrichedPassengers, null, 2));
    // ────────────────────────────────────────────────────────

    const data = await bookFlight({ traceId, resultIndex, passengers: enrichedPassengers });
    res.json(ok(data));

  } catch (e: any) {
    const errMsg = axiosMessage(e);
    console.error("[/tbo/book] ❌ Final error:", errMsg);
    // ── Return full error detail to frontend temporarily ─────
    res.status(400).json({
      ok:      false,
      message: errMsg,
      debug: {
        tboError: (e as any)?.response?.data ?? null,
        message:  errMsg,
      }
    });
  }
});


r.post("/tbo/ticket", async (req, res) => {
  try {
    console.log("[/tbo/ticket] Incoming request body:", JSON.stringify(req.body, null, 2));

    const isLCC = req.body?.isLCC === true;

    // Normalize casing — frontend sends PascalCase, guard against camelCase too
    const traceId     = req.body.TraceId     ?? req.body.traceId;
    const resultIndex = req.body.ResultIndex ?? req.body.resultIndex;
    const passengers  = req.body.Passengers  ?? req.body.passengers;
    const pnr         = req.body.PNR         ?? req.body.pnr;
    const bookingId   = req.body.BookingId   ?? req.body.bookingId;
    const passport    = req.body.Passport    ?? req.body.passport;
    const isPriceChangeAccepted =
      req.body.IsPriceChangeAccepted ?? req.body.isPriceChangeAccepted ?? false;

    if (!traceId) return res.status(400).json(fail("TraceId is required"));

    let data;

    if (isLCC) {
      if (!resultIndex)      return res.status(400).json(fail("ResultIndex is required for LCC ticketing"));
      if (!passengers?.length) return res.status(400).json(fail("Passengers are required for LCC ticketing"));

      data = await ticketFlight({
        type: "lcc",
        data: {
          TraceId:               traceId,
          ResultIndex:           resultIndex,
          Passengers:            passengers,
          IsPriceChangeAccepted: isPriceChangeAccepted,
        },
      });

    } else {
      if (!pnr)       return res.status(400).json(fail("PNR is required for Non-LCC ticketing"));
      if (!bookingId) return res.status(400).json(fail("BookingId is required for Non-LCC ticketing"));

      data = await ticketFlight({
        type: "nonLCC",
        data: {
          TraceId:               traceId,
          PNR:                   pnr,
          BookingId:             Number(bookingId),
          ...(passport?.length ? { Passport: passport } : {}),
          IsPriceChangeAccepted: isPriceChangeAccepted,
        },
      });
    }

    res.json(ok(data));

  } catch (e: any) {
    const errMsg = axiosMessage(e);
    console.error("[/tbo/ticket] Error:", errMsg);
    res.status(400).json(fail(errMsg));
  }
});






// ── 1. ADD THIS IMPORT at the top of index.ts ─────────────────────────────────
// import { generateTicketPdf } from "../../component/flight/ticketPdf.js";


// ── 2. ADD THIS ROUTE after r.post("/tbo/ticket", ...) ────────────────────────

r.post("/tbo/ticket/pdf", async (req, res) => {
  try {
    const body = req.body;
    console.log("[/tbo/ticket/pdf] keys received:", Object.keys(body ?? {}));

    // Body is the reconstructed TicketResponse from BookingPage:
    // { PNR, BookingId, TicketStatus, IsPriceChanged, IsTimeChanged, FlightItinerary }
    const ticketResponse = body?.FlightItinerary
      ? body                          // already top-level shape ✅
      : body?.Response ?? body;       // unwrap if accidentally double-wrapped

    if (!ticketResponse?.FlightItinerary) {
      console.error("[/tbo/ticket/pdf] Missing FlightItinerary. Keys:", Object.keys(body ?? {}));
      return res.status(400).json(fail("Missing FlightItinerary in request body"));
    }

    const pdfBuffer = await generateTicketPdf(ticketResponse);
    const pnr = ticketResponse.PNR
      ?? ticketResponse.FlightItinerary?.PNR
      ?? String(ticketResponse.FlightItinerary?.BookingId ?? "ticket");

    console.log(`[/tbo/ticket/pdf] PDF generated, ${pdfBuffer.length} bytes, PNR: ${pnr}`);

    res.set({
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="ticket-${pnr}.pdf"`,
      "Content-Length":      String(pdfBuffer.length),
      "Cache-Control":       "no-store",
    });
    res.end(pdfBuffer);

  } catch (e: any) {
    console.error("[/tbo/ticket/pdf] Error:", e.message);
    res.status(500).json(fail(e.message ?? "PDF generation failed"));
  }
});




r.post("/tbo/CancelPNR", async (req, res) => {
  try {
    const { bookingId, source } = req.body;

    if (!bookingId) {
      return res.status(400).json(fail("bookingId is required"));
    }
    if (!source) {
      return res.status(400).json(fail("source is required"));
    }

    console.log("[/tbo/CancelPNR] Incoming:", { bookingId, source });

    const data = await cancelPNR({
      bookingId: Number(bookingId),
      source:    String(source),
    });

    res.json(ok(data));
  } catch (e: any) {
    const errMsg = axiosMessage(e);
    console.error("[/tbo/CancelPNR] Error:", errMsg);
    res.status(400).json(fail(errMsg));
  }
});




enum RequestType {
  NotSet              = 0,
  FullCancellation    = 1,
  PartialCancellation = 2,
  Reissuance          = 3,
}
 
enum CancellationType {
  NotSet          = 0,
  NoShow          = 1,
  FlightCancelled = 2,
  Others          = 3,
}
 
r.post("/tbo/SendCancellationRequest", async (req, res) => {
  try {
    const {
      bookingId,
      requestType,       // 0-3, see RequestType enum above
      cancellationType,  // 0-3, see CancellationType enum above
      origin,            // mandatory only when requestType === PartialCancellation
      destination,       // mandatory only when requestType === PartialCancellation
      ticketId,          // integer, or comma-separated string of ticket ids
      remarks,
    } = req.body;
 
    // ── Mandatory field checks (per TBO spec) ─────────────────
    if (!bookingId) {
      return res.status(400).json(fail("bookingId is required"));
    }
    if (requestType === undefined || requestType === null || requestType === "") {
      return res.status(400).json(fail("requestType is required"));
    }
    if (cancellationType === undefined || cancellationType === null || cancellationType === "") {
      return res.status(400).json(fail("cancellationType is required"));
    }
    if (!ticketId) {
      return res.status(400).json(fail("ticketId is required"));
    }
    if (!remarks || String(remarks).trim() === "") {
      return res.status(400).json(fail("remarks is required"));
    }
 
    const requestTypeNum      = Number(requestType);
    const cancellationTypeNum = Number(cancellationType);
 
    if (!(requestTypeNum in RequestType)) {
      return res.status(400).json(fail("requestType must be 0 (NotSet), 1 (FullCancellation), 2 (PartialCancellation), or 3 (Reissuance)"));
    }
    if (!(cancellationTypeNum in CancellationType)) {
      return res.status(400).json(fail("cancellationType must be 0 (NotSet), 1 (NoShow), 2 (FlightCancelled), or 3 (Others)"));
    }
 
    // Origin/Destination are only mandatory for PartialCancellation.
    if (requestTypeNum === RequestType.PartialCancellation) {
      if (!origin)      return res.status(400).json(fail("origin is required for partial cancellation"));
      if (!destination) return res.status(400).json(fail("destination is required for partial cancellation"));
    }
 
    console.log("[/tbo/SendCancellationRequest] Incoming:", {
      bookingId, requestType: requestTypeNum, cancellationType: cancellationTypeNum,
      origin, destination, ticketId, remarks,
    });
 
    // NOTE: EndUserIp and TokenId are NOT accepted from the client body —
    // they're injected server-side (EndUserIp from req.ip / a trusted
    // header, TokenId from your existing TBO auth/session cache) the same
    // way your other TBO routes (search, fare-quote, ticket) already do.
    // If cancelPNR() doesn't already do this internally, wire it there
    // rather than trusting a client-supplied TokenId/EndUserIp.
    const data = await cancelPNRSend({
      bookingId:        Number(bookingId),
      requestType:      requestTypeNum,
      cancellationType: cancellationTypeNum,
      sectors: (origin && destination)
        ? [{ origin: String(origin).toUpperCase(), destination: String(destination).toUpperCase() }]
        : undefined,
      ticketId: String(ticketId), // supports comma-separated multiple ids
      remarks:  String(remarks),
    });
 
    res.json(ok(data));
  } catch (e: any) {
    const errMsg = axiosMessage(e);
    console.error("[/tbo/SendCancellationRequest] Error:", errMsg);
    res.status(400).json(fail(errMsg));
  }
});
 


export default r;