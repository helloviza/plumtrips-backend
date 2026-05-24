// apps/backend/src/routes/flights/index.ts
import { Router } from "express";
// import Razorpay from "razorpay";
import crypto from "crypto";

import {
  searchFlights,
  getFareRule,
  getFareQuote,
  getSSR,
  bookFlight,
  ticketFlight,
  getBookingDetails,
  getAirports,
  getAirlines
} from "../../services/tbo/flight.service.js";

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

const r = Router();

const ok = (data: any) => ({ ok: true, data });
const fail = (message: string, extra: any = {}) => ({ ok: false, message, ...extra });

// ── Razorpay instance ─────────────────────────────────────────────────────
// Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env
// const razorpay = new Razorpay({
//   key_id:     process.env.RAZORPAY_KEY_ID     || "",
//   key_secret: process.env.RAZORPAY_KEY_SECRET || "",
// });

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
      PreferredArrivalTime: `${date}T00:00:00`,
    });

    const Segments: any[] = [seg(departDate, origin, destination)];
    const JourneyType = returnDate ? "2" : "1";
    if (returnDate) Segments.push(seg(returnDate, destination, origin));

    const body = {
      EndUserIp,
      TokenId: token,
      AdultCount: String(adults),
      ChildCount: String(children),
      InfantCount: String(infants),
      DirectFlight: nonStopOnly ? "true" : "false",
      OneStopFlight: oneStopOnly ? "true" : "false",
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
  try {
    const data = await searchFlights(req.body);
    console.log("[tbo/search] ✅ success, TraceId:", data?.Response?.TraceId);
    res.json(ok(data));
  } catch (e: any) {
    const tboData = e?.response?.data;
    console.error("[tbo/search] ❌ ERROR:", {
      message: e.message,
      status: e?.response?.status,
      tboResponse: tboData ? JSON.stringify(tboData).slice(0, 500) : "(no response data)",
    });
    const status = e?.response?.status || 400;
    res.status(status).json(fail(axiosMessage(e), { tboError: tboData?.Response?.Error || null }));
  }
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
    res.status(400).json(fail(axiosMessage(e)));
  }
});

r.post("/tbo/book", async (req, res) => {
  try {
    const data = await bookFlight(req.body);
    res.json(ok(data));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e)));
  }
});

r.post("/tbo/ticket", async (req, res) => {
  try {
    const data = await ticketFlight(req.body);
    res.json(ok(data));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e)));
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
/* Razorpay Payment Integration                                        */
/* ------------------------------------------------------------------ */

/**
 * POST /api/v1/flights/tbo/create-order
 *
 * Creates a Razorpay order for the given amount.
 * The frontend calls this BEFORE opening Razorpay checkout.
 * After the user pays, the frontend calls /verify-payment to confirm.
 *
 * Body: { amount: number (INR paise), currency?: string, receipt?: string, notes?: object }
 */
// r.post("/tbo/create-order", async (req, res) => {
//   try {
//     const { amount, currency = "INR", receipt, notes } = req.body || {};

//     if (!amount || typeof amount !== "number" || amount < 100) {
//       return res.status(400).json(fail("amount (in paise, minimum 100) is required"));
//     }

//     if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
//       return res.status(500).json(fail(
//         "Razorpay keys not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
//       ));
//     }

//     const order = await razorpay.orders.create({
//       amount: Math.round(amount),   // must be integer paise
//       currency,
//       receipt: receipt || `plum_${Date.now()}`,
//       notes: notes || {},
//     });

//     console.log("[create-order] Razorpay order created:", order.id);
//     res.json(ok({ orderId: order.id, amount: order.amount, currency: order.currency }));
//   } catch (e: any) {
//     console.error("[create-order] Razorpay error:", e.message);
//     res.status(500).json(fail(e.message || "Failed to create Razorpay order"));
//   }
// });

/**
 * POST /api/v1/flights/tbo/verify-payment
 *
 * Verifies Razorpay payment signature server-side (HMAC-SHA256).
 * Must be called BEFORE actually booking with TBO.
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
// r.post("/tbo/verify-payment", (req, res) => {
//   try {
//     const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

//     if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//       return res.status(400).json(fail("razorpay_order_id, razorpay_payment_id, razorpay_signature are required"));
//     }

//     const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
//     const body = `${razorpay_order_id}|${razorpay_payment_id}`;
//     const expectedSignature = crypto
//       .createHmac("sha256", keySecret)
//       .update(body)
//       .digest("hex");

//     if (expectedSignature !== razorpay_signature) {
//       console.warn("[verify-payment] Signature mismatch — possible tampering");
//       return res.status(400).json(fail("Payment verification failed — invalid signature"));
//     }

//     console.log("[verify-payment] ✅ Payment verified:", razorpay_payment_id);
//     res.json(ok({ verified: true, paymentId: razorpay_payment_id }));
//   } catch (e: any) {
//     res.status(500).json(fail(e.message || "Verification error"));
//   }
// });

/**
 * POST /api/v1/flights/tbo/book-after-payment
 *
 * Combined endpoint: verifies Razorpay payment then books with TBO.
 * This is the single call the frontend makes after Razorpay checkout succeeds.
 *
 * Body: {
 *   razorpay_order_id, razorpay_payment_id, razorpay_signature,  ← payment proof
 *   traceId, resultIndex, isLCC, passengers, contact, address, gst ← TBO booking params
 * }
 */
// r.post("/tbo/book-after-payment", async (req, res) => {
//   const {
//     razorpay_order_id,
//     razorpay_payment_id,
//     razorpay_signature,
//     ...bookingInput
//   } = req.body || {};

//   // 1. Verify payment first
//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//     return res.status(400).json(fail("Payment credentials missing"));
//   }

//   const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
//   const sigBody = `${razorpay_order_id}|${razorpay_payment_id}`;
//   const expected = crypto
//     .createHmac("sha256", keySecret)
//     .update(sigBody)
//     .digest("hex");

//   if (expected !== razorpay_signature) {
//     console.warn("[book-after-payment] Signature mismatch");
//     return res.status(400).json(fail("Payment verification failed"));
//   }

//   console.log("[book-after-payment] Payment verified:", razorpay_payment_id);

  // 2. Book with TBO
//   try {
//     const data = await bookFlight(bookingInput);

//     // Extract booking details
//     const bookingRes = data?.Response;
//     const bookingId  = bookingRes?.BookingId ?? bookingRes?.TboBookingId;
//     const pnr        = bookingRes?.PNR ?? bookingRes?.Passengers?.[0]?.SegmentAdditionalInfo?.[0]?.Pnr ?? "";

//     res.json(ok({
//       bookingId,
//       pnr,
//       paymentId: razorpay_payment_id,
//       raw: data,
//     }));
//   } catch (e: any) {
//     // IMPORTANT: Payment succeeded but TBO booking failed.
//     // Log this as a critical event — manual reconciliation may be needed.
//     console.error("[book-after-payment] ❌ TBO booking failed AFTER payment:", {
//       paymentId: razorpay_payment_id,
//       orderId: razorpay_order_id,
//       error: e.message,
//     });
//     res.status(500).json(fail(
//       `Payment received but booking failed: ${e.message}. ` +
//       `Please contact support with payment ID: ${razorpay_payment_id}`,
//       { paymentId: razorpay_payment_id, criticalFailure: true }
//     ));
//   }
// });

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
/* Airport list                                                        */
/* ------------------------------------------------------------------ */

r.get("/tbo/airports", (_req, res) => {
  res.json(ok(getAirports()));
});

r.get("/tbo/airlines", (_req, res) => {
  res.json(ok(getAirlines()));
});


r.post("/tbo/ssr", async (req, res) => {
  try {
    const data = await getSSR(req.body);
    res.json(ok(data));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e)));
  }
});
export default r;