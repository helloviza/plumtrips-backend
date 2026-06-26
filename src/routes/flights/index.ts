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
  getSSR,} from "../../component/flight/flightService.js";



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
    const data = await getSSR({
      traceId:          req.body.traceId,
      resultIndex:      req.body.resultIndex
      
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

export default r;




r.post("/tbo/book", async (req, res) => {
  try {
    console.log("[/tbo/book] Incoming request body:", JSON.stringify(req.body, null, 2));

    if (req.body?.isLCC === true) {
      return res.status(400).json(
        fail("LCC flights do not require a book step. Call /tbo/ticket directly.")
      );
    }

    const data = await bookFlight(req.body);  // flat body matches BookInput shape ✅
    res.json(ok(data));

  } catch (e: any) {
    const errMsg = axiosMessage(e);
    console.error("[/tbo/book] Error:", errMsg);
    res.status(400).json(fail(errMsg));
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