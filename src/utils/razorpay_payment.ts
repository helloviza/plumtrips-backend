import Razorpay from "razorpay";
import crypto from "crypto";
import { MAX_AMOUNT_INR, MIN_AMOUNT_INR } from "../services/razorpay_const.js";


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


export function readCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new RazorpayConfigError();
  }
  return { keyId, keySecret };
}

let razorpayClient: Razorpay | null = null;

export function getClient(): Razorpay {
  if (razorpayClient) return razorpayClient;
  const { keyId, keySecret } = readCredentials();
  razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayClient;
}


export function validateAmountInr(amountInr: number): void {
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

export function sanitizeNote(value: string, maxLen = 256): string {
  return value.trim().slice(0, maxLen);
}

export function buildHotelReceipt(bookingCode: string): string {
  const slug = bookingCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `hotel_${slug}_${Date.now()}`.slice(0, 40);
}

export function buildFlightReceipt(bookingCode: string): string {
  const slug = bookingCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `flight_${slug}_${Date.now()}`.slice(0, 40);
}