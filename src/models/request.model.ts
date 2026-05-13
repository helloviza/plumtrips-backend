// models/request.model.ts

export interface CallbackRequest {
  name: string;
  email: string;
  phone: string;
}

export interface CallbackRequestPayload extends CallbackRequest {
  submittedAt: string; // ISO 8601 timestamp
  source?: string;     // e.g. "footer", "contact-page"
}

export interface CallbackRequestResponse {
  success: boolean;
  message: string;
  requestId?: string;  // server-assigned ID for tracking
}

export type CallbackRequestStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface CallbackRequestState {
  form: CallbackRequest;
  status: CallbackRequestStatus;
  error?: string;
}

// Initial/empty form state
export const INITIAL_CALLBACK_FORM: CallbackRequest = {
  name: "",
  email: "",
  phone: "",
};

export const INITIAL_CALLBACK_STATE: CallbackRequestState = {
  form: INITIAL_CALLBACK_FORM,
  status: "idle",
};

// Type guard
export function isCallbackRequest(value: unknown): value is CallbackRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.email === "string" &&
    typeof v.phone === "string"
  );
}

// Validation
export interface CallbackRequestErrors {
  name?: string;
  email?: string;
  phone?: string;
}

export function validateCallbackRequest(
  form: CallbackRequest
): CallbackRequestErrors {
  const errors: CallbackRequestErrors = {};

  if (!form.name.trim()) {
    errors.name = "Full name is required.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!form.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!emailRegex.test(form.email)) {
    errors.email = "Please enter a valid email address.";
  }

  // Accepts formats like +91 98765 43210, 9876543210, +1-800-555-0100
  const phoneRegex = /^\+?[\d\s\-().]{7,15}$/;
  if (!form.phone.trim()) {
    errors.phone = "Phone number is required.";
  } else if (!phoneRegex.test(form.phone)) {
    errors.phone = "Please enter a valid phone number.";
  }

  return errors;
}

export function hasCallbackErrors(errors: CallbackRequestErrors): boolean {
  return Object.keys(errors).length > 0;
}

// Builder — constructs the API payload from the form
export function buildCallbackPayload(
  form: CallbackRequest,
  source: string = "footer"
): CallbackRequestPayload {
  return {
    ...form,
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    submittedAt: new Date().toISOString(),
    source,
  };
}