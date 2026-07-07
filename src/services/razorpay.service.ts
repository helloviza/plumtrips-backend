import Razorpay from "razorpay";
import crypto from "crypto";

const MIN_AMOUNT_INR = 1;
// Razorpay test mode cap is ₹5,00,000. Production supports up to ₹50,00,000.
const MAX_AMOUNT_INR = 500_000;
const DEFAULT_CURRENCY = "INR";

export class RazorpayConfigError extends Error {
  readonly code = "RAZORPAY_NOT_CONFIGURED";
  readonly status = 503;

  constructor(message = "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env") {
    super(message);
    this.name = "RazorpayConfigError";
  }
}

export class RazorpayValidationError extends Error {
  readonly code = "PAYMENT_VALIDATION_ERROR";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RazorpayValidationError";
  }
}

export type HotelPaymentOrderInput = {
  amountInr: number;
  currency?: string;
  bookingCode: string;
  traceId: string;
  hotelName?: string;
};

export type VerifyPaymentInput = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

function readCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new RazorpayConfigError();
  }
  return { keyId, keySecret };
}

let razorpayClient: Razorpay | null = null;

function getClient(): Razorpay {
  if (razorpayClient) return razorpayClient;
  const { keyId, keySecret } = readCredentials();
  razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayClient;
}

export function getRazorpayKeyId(): string {
  return readCredentials().keyId;
}

export function assertRazorpayConfigured(): void {
  readCredentials();
}

function validateAmountInr(amountInr: number): void {
  if (!Number.isFinite(amountInr) || amountInr < MIN_AMOUNT_INR) {
    throw new RazorpayValidationError(`amount must be at least ₹${MIN_AMOUNT_INR}`);
  }
  if (amountInr > MAX_AMOUNT_INR) {
    throw new RazorpayValidationError(
      `Amount ₹${amountInr.toLocaleString("en-IN")} exceeds Razorpay test mode limit of ₹${MAX_AMOUNT_INR.toLocaleString("en-IN")}. ` +
      `Switch to a Razorpay live key or split the payment to proceed.`
    );
  }
}

function sanitizeNote(value: string, maxLen = 256): string {
  return value.trim().slice(0, maxLen);
}

function buildHotelReceipt(bookingCode: string): string {
  const slug = bookingCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `hotel_${slug}_${Date.now()}`.slice(0, 40);
}

function buildFlightReceipt(bookingCode: string): string {
  const slug = bookingCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `flight_${slug}_${Date.now()}`.slice(0, 40);
}

export type FlightPaymentOrderInput = {
  amountInr: number;
  currency?: string;
  bookingCode: string;
  traceId: string;
  flightRoute: string;
  flightDate?: string;
  passengerCount?: number;
};

export async function createFlightPaymentOrder(input: FlightPaymentOrderInput) {
  validateAmountInr(input.amountInr);

  const bookingCode = input.bookingCode.trim();
  const traceId = input.traceId.trim();
  const flightRoute = input.flightRoute.trim();
  if (!bookingCode) throw new RazorpayValidationError("bookingCode is required");
  if (!traceId) throw new RazorpayValidationError("traceId is required");
  if (!flightRoute) throw new RazorpayValidationError("flightRoute is required");

  const currency = (input.currency?.trim().toUpperCase() || DEFAULT_CURRENCY).slice(0, 3);
  if (currency !== DEFAULT_CURRENCY) {
    throw new RazorpayValidationError(`only ${DEFAULT_CURRENCY} is supported for flight bookings`);
  }

  const amountPaise = Math.round(input.amountInr * 100);
  if (amountPaise < 100) {
    throw new RazorpayValidationError("amount is too low for Razorpay (minimum ₹1)");
  }

  const notes: Record<string, string> = {
    type: "flight_booking",
    bookingCode: sanitizeNote(bookingCode),
    traceId: sanitizeNote(traceId),
    flightRoute: sanitizeNote(flightRoute),
  };
  if (input.flightDate?.trim()) {
    notes.flightDate = sanitizeNote(input.flightDate);
  }
  if (typeof input.passengerCount === "number") {
    notes.passengerCount = String(input.passengerCount);
  }

  const client = getClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency,
    receipt: buildFlightReceipt(bookingCode),
    notes,
  });

  return {
    orderId: order.id,
    amount: order.amount,
    amountInr: input.amountInr,
    currency: order.currency,
    receipt: order.receipt,
    status: order.status,
    keyId: getRazorpayKeyId(),
    bookingCode,
    traceId,
    notes: order.notes,
  };
}

export function verifyRazorpayPaymentSignature(input: VerifyPaymentInput): boolean {
  return verifyHotelPaymentSignature(input);
}

export async function createHotelPaymentOrder(input: HotelPaymentOrderInput) {
  validateAmountInr(input.amountInr);

  const bookingCode = input.bookingCode.trim();
  const traceId = input.traceId.trim();
  if (!bookingCode) throw new RazorpayValidationError("bookingCode is required");
  if (!traceId) throw new RazorpayValidationError("traceId is required");

  const currency = (input.currency?.trim().toUpperCase() || DEFAULT_CURRENCY).slice(0, 3);
  if (currency !== DEFAULT_CURRENCY) {
    throw new RazorpayValidationError(`only ${DEFAULT_CURRENCY} is supported for hotel bookings`);
  }

  const amountPaise = Math.round(input.amountInr * 100);
  if (amountPaise < 100) {
    throw new RazorpayValidationError("amount is too low for Razorpay (minimum ₹1)");
  }

  const notes: Record<string, string> = {
    type: "hotel_booking",
    bookingCode: sanitizeNote(bookingCode),
    traceId: sanitizeNote(traceId),
  };
  if (input.hotelName?.trim()) {
    notes.hotelName = sanitizeNote(input.hotelName);
  }

  const client = getClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency,
    receipt: buildHotelReceipt(bookingCode),
    notes,
  });

  return {
    orderId: order.id,
    amount: order.amount,
    amountInr: input.amountInr,
    currency: order.currency,
    receipt: order.receipt,
    status: order.status,
    keyId: getRazorpayKeyId(),
    bookingCode,
    traceId,
    notes: order.notes,
  };
}

export function verifyHotelPaymentSignature(input: VerifyPaymentInput): boolean {
  const { keySecret } = readCredentials();
  const orderId = input.razorpay_order_id.trim();
  const paymentId = input.razorpay_payment_id.trim();
  const signature = input.razorpay_signature.trim();

  if (!orderId || !paymentId || !signature) {
    throw new RazorpayValidationError(
      "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required"
    );
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return expectedSignature === signature;
}

export function mapRazorpayError(err: unknown): { status: number; message: string; code?: string } {
  if (err instanceof RazorpayConfigError) {
    return { status: err.status, message: err.message, code: err.code };
  }
  if (err instanceof RazorpayValidationError) {
    return { status: err.status, message: err.message, code: err.code };
  }

  const e = err as { statusCode?: number; error?: { description?: string; code?: string }; message?: string };
  const status = e?.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 502;
  const message =
    e?.error?.description ||
    e?.message ||
    "Payment provider request failed";

  return { status, message, code: e?.error?.code };
}
