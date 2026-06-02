import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  assertRazorpayConfigured,
  createHotelPaymentOrder,
  createFlightPaymentOrder,
  mapRazorpayError,
  verifyHotelPaymentSignature,
  verifyRazorpayPaymentSignature,
} from "../services/razorpay.service.js";

const router = Router();

const ok = (data: unknown) => ({ ok: true as const, data });
const fail = (error: string, extra?: Record<string, unknown>) => ({ ok: false as const, error, ...extra });

const hotelOrderSchema = z.object({
  amount: z.coerce.number().positive("amount must be a positive number (INR)"),
  currency: z.string().trim().optional(),
  bookingCode: z.string().trim().min(1, "bookingCode is required"),
  traceId: z.string().trim().min(1, "traceId is required — use the traceId from hotel search/prebook"),
  hotelName: z.string().trim().optional(),
});

const flightOrderSchema = z.object({
  amount: z.coerce.number().positive("amount must be a positive number (INR)"),
  currency: z.string().trim().optional(),
  bookingCode: z.string().trim().min(1, "bookingCode is required"),
  traceId: z.string().trim().min(1, "traceId is required — use the traceId from flight search/book"),
  flightRoute: z.string().trim().min(1, "flightRoute is required"),
  flightDate: z.string().trim().optional(),
  passengerCount: z.number().int().positive().optional(),
});

const verifySchema = z.object({
  razorpay_order_id: z.string().trim().min(1, "razorpay_order_id is required"),
  razorpay_payment_id: z.string().trim().min(1, "razorpay_payment_id is required"),
  razorpay_signature: z.string().trim().min(1, "razorpay_signature is required"),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): { data?: T; error?: string } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const path = first.path.length ? `${first.path.join(".")}: ` : "";
    return { error: `${path}${first.message}` };
  }
  return { data: parsed.data };
}

async function handleCreateOrder(req: Request, res: Response) {
  const parsed = parseBody(hotelOrderSchema, req.body);
  if (parsed.error) return res.status(400).json(fail(parsed.error));

  try {
    assertRazorpayConfigured();
    const { amount, currency, bookingCode, traceId, hotelName } = parsed.data!;
    const data = await createHotelPaymentOrder({
      amountInr: amount,
      currency,
      bookingCode,
      traceId,
      hotelName,
    });
    return res.json(ok(data));
  } catch (err) {
    const mapped = mapRazorpayError(err);
    console.error("[payments] hotel order error:", mapped.message, err);
    return res.status(mapped.status).json(fail(mapped.message, mapped.code ? { code: mapped.code } : undefined));
  }
}

async function handleCreateFlightOrder(req: Request, res: Response) {
  const parsed = parseBody(flightOrderSchema, req.body);
  if (parsed.error) return res.status(400).json(fail(parsed.error));

  try {
    assertRazorpayConfigured();
    const { amount, currency, bookingCode, traceId, flightRoute, flightDate, passengerCount } = parsed.data!;
    const data = await createFlightPaymentOrder({
      amountInr: amount,
      currency,
      bookingCode,
      traceId,
      flightRoute,
      flightDate,
      passengerCount,
    });
    return res.json(ok(data));
  } catch (err) {
    const mapped = mapRazorpayError(err);
    console.error("[payments] flight order error:", mapped.message, err);
    return res.status(mapped.status).json(fail(mapped.message, mapped.code ? { code: mapped.code } : undefined));
  }
}

function handleVerify(req: Request, res: Response) {
  const parsed = parseBody(verifySchema, req.body);
  if (parsed.error) return res.status(400).json(fail(parsed.error));

  try {
    assertRazorpayConfigured();
    const fields = parsed.data!;
    const verified = verifyRazorpayPaymentSignature(fields);

    if (!verified) {
      return res.status(400).json(fail("Invalid payment signature"));
    }

    return res.json(
      ok({
        verified: true,
        razorpay_order_id: fields.razorpay_order_id,
        razorpay_payment_id: fields.razorpay_payment_id,
        message: "Payment verified successfully. Proceed with your booking flow.",
      })
    );
  } catch (err) {
    const mapped = mapRazorpayError(err);
    console.error("[payments] verify error:", mapped.message, err);
    return res.status(mapped.status).json(fail(mapped.message, mapped.code ? { code: mapped.code } : undefined));
  }
}

/**
 * POST /api/v1/payments/hotel/order
 * Create a Razorpay order for a hotel booking (after prebook, before TBO /book).
 *
 * Body: { amount, bookingCode, traceId, currency?, hotelName? }
 * amount — total fare in INR (from prebook/search), not paise
 */
router.post("/hotel/order", handleCreateOrder);
router.post("/flight/order", handleCreateFlightOrder);

/**
 * POST /api/v1/payments/hotel/verify
 * POST /api/v1/payments/flight/verify
 * Verify Razorpay payment signature after checkout.
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post("/hotel/verify", handleVerify);
router.post("/flight/verify", handleVerify);

/** Backward-compatible aliases */
router.post("/razorpay/order", handleCreateOrder);
router.post("/razorpay/verify", handleVerify);

router.get("/health", (_req: Request, res: Response) => {
  try {
    assertRazorpayConfigured();
    return res.json({ ok: true, service: "payments", razorpay: "configured" });
  } catch {
    return res.status(503).json({ ok: false, service: "payments", razorpay: "not_configured" });
  }
});

export default router;
