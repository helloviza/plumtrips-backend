// src/services/tbo/hotel.service.ts
//
// TBO Hotel API — per https://apidoc.tektravels.com/hotelnew/
//
//  Static API  (http://api.tbotechnology.in/TBOHolidays_HotelAPI)
//    Auth: Basic Auth — TBOStaticAPITest:Tbo@11530818
//    Endpoints: CountryList(GET), CityList(POST), TBOHotelCodeList(POST),
//               HotelCodeList(GET), Hoteldetails(POST)
//
//  Booking API
//    Search / PreBook / GetBookingDetails / Cancel → HOTEL_BASE (default affiliate …/HotelAPI)
//    Book (final confirm) → HOTEL_BOOK_BASE (HotelService.svc/rest — affiliate often has no /Book route)
//    Auth: Basic Auth + JSON TokenId + TraceId (Search → PreBook → Book)
//
// IMPORTANT — Search flow:
//   1. Get hotel codes for a city via TBOHotelCodeList (static API)
//   2. Pass those codes (max 100 per request) as HotelCodes to /Search
//   There is NO CityId parameter in the Search API.

import type { AxiosInstance } from "axios";
import { randomUUID } from "node:crypto";
import { httpHotel, httpHotelStatic, httpHotelBook, httpHotelCancel } from "../../lib/http.js";
import { getStaticAuthHeader, getBookingAuthHeader } from "../tbo/hotel.auth.service.js";
import { authenticate, resolveBookingEndUserIp } from "../tbo/auth.service.js";

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

/** Validate YYYY-MM-DD — TBO Search/PreBook accept this format directly */
export function toTboDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid date format "${isoDate}" — expected YYYY-MM-DD`);
  }
  return isoDate;
}

/** Validate date range, return number of nights */
export function validateDateRange(checkIn: string, checkOut: string): number {
  const inDate  = new Date(checkIn);
  const outDate = new Date(checkOut);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  if (isNaN(inDate.getTime()))  throw new Error(`Invalid checkIn date: "${checkIn}"`);
  if (isNaN(outDate.getTime())) throw new Error(`Invalid checkOut date: "${checkOut}"`);
  if (inDate < today)           throw new Error("checkIn date cannot be in the past");
  if (outDate <= inDate)        throw new Error("checkOut must be after checkIn");

  const nights = Math.round((outDate.getTime() - inDate.getTime()) / 86_400_000);
  if (nights > 30) throw new Error("Maximum stay is 30 nights");
  return nights;
}

/* ------------------------------------------------------------------ */
/* PreBook → Book — extract NetAmount (TBO response shape variants)   */
/* ------------------------------------------------------------------ */

function normalizeFiniteNumber(val: unknown): number | undefined {
  if (val == null || val === "") return undefined;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(String(val).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeDateString(val: unknown): string | undefined {
  if (val == null || val === "") return undefined;
  if (typeof val === "string") {
    const str = val.trim();
    return str ? str : undefined;
  }
  if (typeof val === "number" && Number.isFinite(val)) {
    const date = new Date(val);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function parsePolicyDate(val: unknown): Date | undefined {
  if (val == null || val === "") return undefined;
  if (typeof val === "number" && Number.isFinite(val)) {
    const date = new Date(val);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof val !== "string") return undefined;

  const raw = val.trim();
  if (!raw) return undefined;

  const isoMatch = raw.match(/^\s*(\d{4})[\/\-](\d{2})[\/\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+\-])(\d{2}):?(\d{2}))?)?\s*$/);
  if (isoMatch) {
    const [, year, month, day, hour = "00", minute = "00", second = "00", tzSign, tzHour = "00", tzMin = "00"] = isoMatch;
    if (tzSign) {
      const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}${tzHour}:${tzMin}`;
      const date = new Date(isoString);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  const altMatch = raw.match(/^\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*$/);
  if (altMatch) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = altMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatPolicyDate(val: unknown): string | undefined {
  const date = parsePolicyDate(val);
  if (!date) return undefined;

  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysToPolicyDate(val: unknown, days: number): string | undefined {
  const date = parsePolicyDate(val);
  if (!date) return undefined;

  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function coerceArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function normalizeCancellationPolicyItem(raw: unknown, defaultCurrency?: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const charge = normalizeFiniteNumber(item.charge ?? item.Charge ?? item.CancellationCharge ?? item.cancellationCharge);

  // ChargeType can be a string ("Fixed", "Percentage", "Night") or a number (0,1,2,3)
  // Preserve the original string so the frontend can display it correctly.
  const rawChargeType = item.chargeType ?? item.ChargeType ?? item.CancellationChargeType ?? item.cancellationType ?? item.CancellationType;
  const chargeTypeStr = rawChargeType != null ? String(rawChargeType).trim() : undefined;
  const chargeTypeNum = normalizeFiniteNumber(rawChargeType);

  const currency = String(item.currency ?? item.Currency ?? item.CurrencyCode ?? defaultCurrency ?? "").trim() || undefined;
  const fromDate = formatPolicyDate(
    item.fromDate ?? item.FromDate ?? item.From ?? item.fromDateCutoff ?? item.CutoffFromDate
  );
  const toDate = formatPolicyDate(
    item.toDate ?? item.ToDate ?? item.To ?? item.toDateCutoff ?? item.LastCancellationDate ?? item.FreeCancellationUntil ?? item.CutoffDate
  );
  const remarks = String(item.remarks ?? item.Remarks ?? item.Remark ?? item.CancellationPolicy ?? "").trim() || undefined;

  if (charge === undefined && chargeTypeStr === undefined && !currency && !fromDate && !toDate && !remarks) return null;

  const normalized: Record<string, unknown> = {};
  if (charge !== undefined) {
    normalized.charge = charge;
    normalized.CancellationCharge = charge;
    normalized.amount = charge;
  }
  if (chargeTypeStr !== undefined) {
    // Always keep the string form so frontend can display "Fixed" vs "Percentage"
    normalized.chargeType = chargeTypeStr;
    normalized.ChargeType = chargeTypeStr;
  }
  if (chargeTypeNum !== undefined) {
    normalized.chargeTypeNum = chargeTypeNum;
  }
  if (currency) {
    normalized.currency = currency;
    normalized.Currency = currency;
    normalized.currencyCode = currency;
  }
  if (fromDate) {
    normalized.fromDate = fromDate;
    normalized.FromDate = fromDate;
  }
  if (toDate) {
    normalized.toDate = toDate;
    normalized.ToDate = toDate;
  }
  if (remarks) {
    normalized.remarks = remarks;
    normalized.Remarks = remarks;
  }
  return normalized;
}

function sortCancellationPolicies(policies: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return policies.slice().sort((a, b) => {
    const aDate = parsePolicyDate(a.fromDate ?? a.FromDate ?? a.toDate ?? a.ToDate ?? "");
    const bDate = parsePolicyDate(b.fromDate ?? b.FromDate ?? b.toDate ?? b.ToDate ?? "");
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.getTime() - bDate.getTime();
  });
}

function normalizeRoomCancellationPolicies(room: Record<string, unknown>): void {
  const currency = String(room.currency ?? room.Currency ?? room.CurrencyCode ?? room.CurrencyType ?? "").trim() || undefined;
  const rawPolicies = room.CancellationPolicies ?? room.CancelPolicies ?? room.CancellationPolicy ?? room.CancelPolicy;
  const policies = coerceArray(rawPolicies)
    .map((item) => normalizeCancellationPolicyItem(item, currency))
    .filter((item): item is Record<string, unknown> => item !== null);

  if (policies.length > 0) {
    const sorted: Record<string, unknown>[] = sortCancellationPolicies(policies).map((item) => ({
      ...item,
      amount: item.charge ?? item.CancellationCharge,
      currencyCode: item.currency ?? item.Currency ?? item.CurrencyCode,
      description: item.remarks ?? item.Remarks,
    }));

    room.CancelPolicies = sorted;
    room.CancellationPolicies = sorted;

    const freePolicy = sorted.find((item) => normalizeFiniteNumber(item.amount) === 0);
    if (freePolicy) {
      const freeDeadline = String(
        freePolicy.toDate ?? freePolicy.ToDate ?? freePolicy.fromDate ?? freePolicy.FromDate ?? freePolicy.From ?? ""
      ).trim();
      const canonicalDeadline = formatPolicyDate(freeDeadline);
      if (canonicalDeadline) {
        room.LastCancellationDate = canonicalDeadline;
        room.FreeCancellationUntil = canonicalDeadline;

        const hasPenalty = sorted.some((item) => normalizeFiniteNumber(item.amount) !== 0);
        if (!hasPenalty) {
          // TBO returns real charges — don't fabricate a penalty slab.
          // The frontend will show "Cancellation charges apply after {date}"
          // without a specific amount if none is present in the real data.
        }
      }
    }

    if (!freePolicy) {
      const earliestPenalty = sorted
        .filter((item) => normalizeFiniteNumber(item.amount) !== 0)
        .sort((a, b) => {
          const aDate = parsePolicyDate(a.fromDate ?? a.FromDate ?? "");
          const bDate = parsePolicyDate(b.fromDate ?? b.FromDate ?? "");
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return aDate.getTime() - bDate.getTime();
        })[0] as Record<string, unknown> | undefined;

      if (earliestPenalty) {
        const penaltyFromDate = String(earliestPenalty.fromDate ?? earliestPenalty.FromDate ?? earliestPenalty.From ?? "").trim();
        const penaltyCutoff = addDaysToPolicyDate(penaltyFromDate, -1);
        if (penaltyCutoff) {
          room.LastCancellationDate = penaltyCutoff;
          room.FreeCancellationUntil = penaltyCutoff;
        }
      }
    }

    return;
  }

  const cutoff = normalizeDateString(room.LastCancellationDate ?? room.FreeCancellationUntil ?? room.LastCancellationDeadline ?? room.CutoffDate);
  if (cutoff != null) {
    const normalizedCutoff = formatPolicyDate(cutoff) ?? cutoff;
    const freePolicy: Record<string, unknown> = {
      charge: 0,
      CancellationCharge: 0,
      amount: 0,
      chargeType: 0,
      ChargeType: 0,
      currency,
      currencyCode: currency,
      toDate: normalizedCutoff,
      ToDate: normalizedCutoff,
      remarks: "Free cancellation until this date",
      Remarks: "Free cancellation until this date",
      description: "Free cancellation until this date",
    };
    if (normalizeDateString(room.FromDate ?? room.fromDate ?? room.fromDateCutoff ?? room.CutoffFromDate)) {
      const freeFrom = normalizeDateString(room.FromDate ?? room.fromDate ?? room.fromDateCutoff ?? room.CutoffFromDate);
      if (freeFrom) {
        freePolicy.fromDate = freeFrom;
        freePolicy.FromDate = freeFrom;
      }
    }
    const penaltyDate = addDaysToPolicyDate(normalizedCutoff, 1);
    // Don't fabricate a penalty amount — TBO provides real charges
    // in CancelPolicies. Just set the free slab; the UI will note
    // that charges apply after the deadline without a specific amount.
    room.CancelPolicies = [freePolicy];
    room.CancellationPolicies = [freePolicy];
    room.LastCancellationDate = normalizedCutoff;
    room.FreeCancellationUntil = normalizedCutoff;
  }
}

function normalizePreBookCancellationResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const root = raw as Record<string, unknown>;
  const envelope = (root.Response && typeof root.Response === "object" ? root.Response : root) as Record<string, unknown>;

  const hotelResults = coerceArray(envelope.HotelResult ?? envelope.hotelResult);
  for (const hr of hotelResults) {
    if (!hr || typeof hr !== "object") continue;
    const roomsRaw = (hr as Record<string, unknown>).HotelRoomsDetails ?? (hr as Record<string, unknown>).Rooms ?? (hr as Record<string, unknown>).rooms ?? (hr as Record<string, unknown>).RoomDetails;
    const rooms = coerceArray(roomsRaw);
    for (const room of rooms) {
      if (room && typeof room === "object") {
        const roomRecord = room as Record<string, unknown>;
        normalizeRoomCancellationPolicies(roomRecord);

        if (roomRecord.CancelPolicies && Array.isArray(roomRecord.CancelPolicies)) {
          roomRecord.CancelPolicies = roomRecord.CancelPolicies.map((policy) => {
            const p = policy as Record<string, unknown>;
            if (p.Index == null && p.index != null) p.Index = p.index;
            if (p.FromDate == null && p.fromDate != null) p.FromDate = p.fromDate;
            if (p.ChargeType == null && p.chargeType != null) p.ChargeType = p.chargeType;
            if (p.CancellationCharge == null && p.amount != null) p.CancellationCharge = p.amount;
            if (p.CancellationCharge == null && p.charge != null) p.CancellationCharge = p.charge;
            return p;
          });
        }
      }
    }
  }

  return raw;
}

/**
 * Search echoes TraceId under `Response`; some stacks wrap PreBook the same way.
 */
function unwrapTboHotelPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const inner = o.Response;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const r = inner as Record<string, unknown>;
    if (r.HotelResult != null || r.hotelResult != null) return r;
  }
  return o;
}

function coerceHotelResultArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

/**
 * Fare for TBO /Book NetAmount — must align with PreBook **TotalFare** semantics.
 * Avoid `room.NetAmount` / mixed fields: they can disagree with TotalFare and cause
 * intermittent "Invalid Net Amount" when TBO reconciles against PreBook.
 */
function roomTboBookFare(room: Record<string, unknown>): number | undefined {
  const fromTotal =
    normalizeFiniteNumber(room.TotalFare) ??
    normalizeFiniteNumber(room.Totalfare) ??
    normalizeFiniteNumber((room as { totalFare?: unknown }).totalFare);
  if (fromTotal !== undefined) return fromTotal;
  return (
    normalizeFiniteNumber(room.TotalPrice) ??
    normalizeFiniteNumber(room.RoomFare)
  );
}

function roomTotalTax(room: Record<string, unknown>): number | undefined {
  return (
    normalizeFiniteNumber(room.TotalTax) ??
    normalizeFiniteNumber(room.Totaltax) ??
    normalizeFiniteNumber((room as { totalTax?: unknown }).totalTax) ??
    normalizeFiniteNumber(room.Tax)
  );
}

type PreBookRoomPick = {
  hotelResult: unknown;
  room:        Record<string, unknown>;
  totalFare:   number;
  totalTax?:   number;
};

/**
 * Prefer the room whose BookingCode matches the flow; TBO can return multiple rooms
 * and using only Rooms[0] breaks when the guest picked another rate.
 */
function pickPreBookRoomForBook(preBookRaw: unknown, requestedBookingCode: string): PreBookRoomPick | null {
  const root = unwrapTboHotelPayload(preBookRaw);
  if (!root) return null;

  const wanted = String(requestedBookingCode || "").trim();
  const hotels = coerceHotelResultArray(root.HotelResult ?? root.hotelResult);

  const tryHotels = (matchBookingCode: boolean): PreBookRoomPick | null => {
    for (const hr of hotels) {
      if (!hr || typeof hr !== "object") continue;
      const roomsRaw = (hr as Record<string, unknown>).Rooms ?? (hr as Record<string, unknown>).rooms;
      const rooms = Array.isArray(roomsRaw) ? roomsRaw : [];
      for (const rm of rooms) {
        if (!rm || typeof rm !== "object") continue;
        const room = rm as Record<string, unknown>;
        if (matchBookingCode && wanted) {
          const bc = String(room.BookingCode ?? "").trim();
          if (bc !== wanted) continue;
        }
        const tf = roomTboBookFare(room);
        if (tf !== undefined) return { hotelResult: hr, room, totalFare: tf, totalTax: roomTotalTax(room) };
      }
    }
    return null;
  };

  const byCode = wanted ? tryHotels(true) : null;
  return byCode ?? tryHotels(false);
}

/**
 * TBO compares Book.NetAmount to PreBook pricing. For multi-room (`NoOfRooms` > 1),
 * a single `Rooms[]` row is often **per-room** fare — sending one room's TotalFare as
 * NetAmount while posting N `HotelRoomsDetails` entries causes "Invalid Net Amount".
 * This aggregates: sum of the first N matching room rows, or (one row × N) when only one matches.
 */
function aggregateFareForRooms(
  hotelResult: Record<string, unknown> | undefined,
  bookingCodes: Set<string>,
  roomsN: number,
  fallback: { totalFare: number; totalTax?: number }
): { totalFare: number; totalTax?: number } {
  if (!hotelResult || roomsN < 1) return fallback;
  const roomsRaw = hotelResult.Rooms ?? hotelResult.rooms;
  if (!Array.isArray(roomsRaw) || roomsRaw.length === 0) return fallback;

  const matching: Record<string, unknown>[] = [];
  for (const rm of roomsRaw) {
    if (!rm || typeof rm !== "object") continue;
    const r = rm as Record<string, unknown>;
    const bc = String(r.BookingCode ?? "").trim();
    if (bc && bookingCodes.has(bc)) matching.push(r);
  }
  if (!matching.length) return fallback;

  if (matching.length >= roomsN) {
    let fare = 0;
    let tax = 0;
    let taxAny = false;
    for (let i = 0; i < roomsN; i++) {
      const tf = roomTboBookFare(matching[i]);
      const tt = roomTotalTax(matching[i]);
      if (tf !== undefined) fare += tf;
      if (tt !== undefined) {
        tax += tt;
        taxAny = true;
      }
    }
    return { totalFare: fare, totalTax: taxAny ? tax : fallback.totalTax };
  }

  if (matching.length === 1 && roomsN > 1) {
    const tf = roomTboBookFare(matching[0]);
    const tt = roomTotalTax(matching[0]);
    if (tf === undefined) return fallback;
    return {
      totalFare: tf * roomsN,
      totalTax: tt !== undefined ? tt * roomsN : fallback.totalTax,
    };
  }

  return fallback;
}

function isInvalidNetAmountMessage(msg: string): boolean {
  return /invalid\s+net\s+amount/i.test(String(msg || ""));
}

function dedupeBookStrategies(
  rows: { label: string; net: number; taxes?: number }[]
): { label: string; net: number; taxes?: number }[] {
  const seen = new Set<string>();
  const out: { label: string; net: number; taxes?: number }[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.net)) continue;
    const key = `${r.net}|${r.taxes ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Search/PreBook API helper (affiliate.tektravels.com/HotelAPI)      */
/* ------------------------------------------------------------------ */

/**
 * POST to a TBO hotel axios client (affiliate HotelAPI or HotelService Book host).
 * Search/PreBook use httpHotel; final Book uses httpHotelBook.
 */
async function tboPostWithClient<T = any>(
  client: AxiosInstance,
  path: string,
  body: Record<string, any>,
  options?: { timeout?: number }
): Promise<T> {
  let authHeader: string;
  try {
    authHeader = getBookingAuthHeader();
  } catch (e: any) {
    throw Object.assign(new Error(e.message), { code: "AUTH_MISSING" });
  }

  let responseData: any;
  try {
    const { data } = await client.post(path, body, {
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        Authorization:  authHeader,
      },
      ...(options?.timeout != null ? { timeout: options.timeout } : {}),
    });
    responseData = data;
  } catch (err: any) {
    const status  = err?.response?.status;
    const resBody = err?.response?.data;
    const logTag = client === httpHotelBook ? "[hotel-book]" : "[hotel]";
    console.error(`${logTag} ${path} HTTP error`, { status, response: resBody });

    if (status === 401) {
      throw new Error("TBO hotel API: authentication failed (401). Check TBO_UserName / TBO_Password.");
    }
    if (status === 404) {
      throw new Error(
        `TBO hotel endpoint not found: ${path}. This operation may not be available for this account type. Contact TBO support.`
      );
    }
    if (!status || status >= 500) {
      throw Object.assign(
        new Error(`TBO hotel service unreachable (HTTP ${status ?? "no response"})`),
        { code: "TBO_UNREACHABLE" }
      );
    }
    const msg =
      resBody?.Response?.Error?.ErrorMessage ||
      resBody?.BookResult?.Error?.ErrorMessage ||
      resBody?.Status?.Description ||
      err?.message ||
      "TBO request failed";
    throw new Error(msg);
  }

  const logTag = client === httpHotelBook ? "[hotel-book]" : "[hotel]";

  // ── Guard: TBO sometimes returns a plain string on hard failures ──────────
  // e.g. "Invalid Resource Requested!" instead of a JSON object.
  // Treat any non-object response as a fatal TBO error.
  if (typeof responseData === "string" || typeof responseData !== "object" || responseData === null) {
    const msg = typeof responseData === "string" ? responseData.trim() : "TBO returned an unexpected non-object response";
    console.error(`${logTag} ${path} TBO returned non-object response:`, responseData);
    throw new Error(`TBO rejected the request: ${msg}`);
  }

  // ── Structured TBO error envelopes ───────────────────────────────────────
  const errFromResponse   = responseData?.Response?.Error;
  const errFromBookResult = responseData?.BookResult?.Error;
  const tboErr = errFromBookResult || errFromResponse;

  if (tboErr && tboErr.ErrorCode && tboErr.ErrorCode !== 0) {
    const msg = tboErr.ErrorMessage || "TBO error";
    console.error(`${logTag} ${path} TBO error`, {
      code: tboErr.ErrorCode,
      msg,
      envelope: errFromBookResult ? "BookResult" : "Response",
    });
    throw Object.assign(new Error(msg), { tboCode: tboErr.ErrorCode });
  }

  // ── Top-level Status error (some TBO endpoints use this pattern) ──────────
  // TBO uses Code: 1 for success on booking endpoints, but Code: 200 for search.
  // Only treat it as an error when Code is explicitly a known failure code.
  const topStatus = responseData?.Status;
  if (topStatus && typeof topStatus === "object") {
    const code = Number(topStatus.Code);
    // Code 0, 1, 200 are all success variants across different TBO endpoints
    // Code 201 is "No Available rooms" for Search — treat as an empty success, not an error
    const isFailure = code !== 0 && code !== 1 && code !== 200 && code !== 201;
    if (isFailure) {
      // If TBO provided a failure code (e.g. 300) BUT still returned HotelResult data,
      // allow it to pass through so we can extract the cancellation policies.
      const hasData = responseData?.HotelResult || responseData?.Response?.HotelResult;
      if (!hasData) {
        const msg = topStatus.Description || topStatus.Message || `TBO status code ${topStatus.Code}`;
        console.error(`${logTag} ${path} TBO Status error`, topStatus);
        throw new Error(`TBO error: ${msg}`);
      }
    }
  }

  return responseData as T;
}

async function tboPost<T = any>(path: string, body: Record<string, any>): Promise<T> {
  return tboPostWithClient(httpHotel, path, body);
}

/* ------------------------------------------------------------------ */
/* Static API helper                                                   */
/* ------------------------------------------------------------------ */

async function tboStaticPost<T = any>(
  path: string,
  body: Record<string, any>
): Promise<T> {
  let responseData: any;
  try {
    const { data } = await httpHotelStatic.post(path, body, {
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        Authorization:  getStaticAuthHeader(),
      },
    });
    responseData = data;
  } catch (err: any) {
    const status  = err?.response?.status;
    const resBody = err?.response?.data;
    console.error(`[hotel-static] ${path} HTTP error`, { status, response: resBody });

    if (!status || status >= 500) {
      throw Object.assign(
        new Error(`TBO hotel static service unreachable (HTTP ${status ?? "no response"})`),
        { code: "TBO_UNREACHABLE" }
      );
    }
    const msg = resBody?.Status?.Description || resBody?.message || err?.message || "TBO static request failed";
    throw new Error(msg);
  }

  return responseData as T;
}

async function tboStaticGet<T = any>(path: string): Promise<T> {
  let responseData: any;
  try {
    const { data } = await httpHotelStatic.get(path, {
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        Authorization:  getStaticAuthHeader(),
      },
    });
    responseData = data;
  } catch (err: any) {
    const status  = err?.response?.status;
    const resBody = err?.response?.data;
    console.error(`[hotel-static] GET ${path} HTTP error`, { status, response: resBody });

    if (!status || status >= 500) {
      throw Object.assign(
        new Error(`TBO hotel static service unreachable (HTTP ${status ?? "no response"})`),
        { code: "TBO_UNREACHABLE" }
      );
    }
    throw new Error(resBody?.message || err?.message || "TBO static GET failed");
  }

  return responseData as T;
}

/* ------------------------------------------------------------------ */
/* Built-in city fallback                                             */
/* ------------------------------------------------------------------ */

const TBO_CITY_LIST = [
  { Code: "144306", Name: "Mumbai", CountryCode: "IN" },
  { Code: "418069", Name: "Delhi", CountryCode: "IN" },
  { Code: "111124", Name: "Bangalore", CountryCode: "IN" },
  { Code: "113128", Name: "Kolkata", CountryCode: "IN" },
  { Code: "127343", Name: "Chennai", CountryCode: "IN" },
  { Code: "145710", Name: "Hyderabad", CountryCode: "IN" },
  { Code: "133133", Name: "Pune", CountryCode: "IN" },
  { Code: "100263", Name: "Ahmedabad", CountryCode: "IN" },
  { Code: "122175", Name: "Jaipur", CountryCode: "IN" },
  { Code: "108256", Name: "Goa", CountryCode: "IN" },
  { Code: "101204", Name: "Kochi", CountryCode: "IN" },
  { Code: "100589", Name: "Agra", CountryCode: "IN" },
  { Code: "140522", Name: "Udaipur", CountryCode: "IN" },
  { Code: "141618", Name: "Varanasi", CountryCode: "IN" },
  { Code: "101129", Name: "Amritsar", CountryCode: "IN" },
  { Code: "114107", Name: "Chandigarh", CountryCode: "IN" },
  { Code: "121726", Name: "Indore", CountryCode: "IN" },
  { Code: "144735", Name: "Coimbatore", CountryCode: "IN" },
  { Code: "139526", Name: "Surat", CountryCode: "IN" },
  { Code: "343378", Name: "Mysore", CountryCode: "IN" },
  { Code: "129723", Name: "Nagpur", CountryCode: "IN" },
  { Code: "132429", Name: "Patna", CountryCode: "IN" },
  { Code: "111932", Name: "Bhopal", CountryCode: "IN" },
  { Code: "126666", Name: "Lucknow", CountryCode: "IN" },
  { Code: "142198", Name: "Visakhapatnam", CountryCode: "IN" },
  { Code: "126388", Name: "Manali", CountryCode: "IN" },
  { Code: "138673", Name: "Shimla", CountryCode: "IN" },
  { Code: "116264", Name: "Darjeeling", CountryCode: "IN" },
  { Code: "130990", Name: "Ooty", CountryCode: "IN" },
  { Code: "134932", Name: "Rishikesh", CountryCode: "IN" },
  { Code: "121186", Name: "Haridwar", CountryCode: "IN" },
  { Code: "116164", Name: "Dehradun", CountryCode: "IN" },
  { Code: "129726", Name: "Nainital", CountryCode: "IN" },
  { Code: "130341", Name: "Mussoorie", CountryCode: "IN" },
  { Code: "145836", Name: "Jodhpur", CountryCode: "IN" },
  { Code: "134001", Name: "Pushkar", CountryCode: "IN" },
  { Code: "100804", Name: "Ajmer", CountryCode: "IN" },
  { Code: "146752", Name: "Mount Abu", CountryCode: "IN" },
  { Code: "110349", Name: "Aurangabad", CountryCode: "IN" },
  { Code: "146814", Name: "Nashik", CountryCode: "IN" },
  { Code: "125684", Name: "Mahabaleshwar", CountryCode: "IN" },
  { Code: "126630", Name: "Lonavala", CountryCode: "IN" },
  { Code: "127067", Name: "Madurai", CountryCode: "IN" },
  { Code: "140311", Name: "Tirupati", CountryCode: "IN" },
  { Code: "132561", Name: "Pondicherry", CountryCode: "IN" },
  { Code: "139820", Name: "Trivandrum", CountryCode: "IN" },
  { Code: "128573", Name: "Munnar", CountryCode: "IN" },
  { Code: "109524", Name: "Alleppey", CountryCode: "IN" },
  { Code: "139609", Name: "Thekkady", CountryCode: "IN" },
  { Code: "123897", Name: "Kovalam", CountryCode: "IN" },
  { Code: "115936", Name: "Dubai",         CountryCode: "AE" },
  { Code: "138703", Name: "Singapore",     CountryCode: "SG" },
  { Code: "144092", Name: "Bangkok",       CountryCode: "TH" },
  { Code: "126632", Name: "London",        CountryCode: "GB" },
  { Code: "131408", Name: "Paris",         CountryCode: "FR" },
  { Code: "128788", Name: "New York",      CountryCode: "US" },
  { Code: "110670", Name: "Bali",          CountryCode: "ID" },
  { Code: "131529", Name: "Phuket",        CountryCode: "TH" },
  { Code: "123768", Name: "Kuala Lumpur",  CountryCode: "MY" },
  { Code: "145656", Name: "Hong Kong",     CountryCode: "HK" },
  { Code: "101365", Name: "Maldives",      CountryCode: "MV" },
  { Code: "144745", Name: "Colombo",       CountryCode: "LK" },
  { Code: "145898", Name: "Kathmandu",     CountryCode: "NP" },
  { Code: "139080", Name: "Thimphu",       CountryCode: "BT" },
];

/* ================================================================== */
/* STATIC API                                                         */
/* ================================================================== */

/** GET /CountryList — no parameters */
export async function getCountryList() {
  return tboStaticGet("/CountryList");
}

/* ------------------------------------------------------------------ */
/* City search — single country or global (all TBO countries)         */
/* ------------------------------------------------------------------ */

type TboCityRow = { Code: string; Name: string; CountryCode: string };

const CITY_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
const GLOBAL_CITY_RESULT_LIMIT = 50;
const CITY_SEARCH_CONCURRENCY = 12;

/** High-traffic destinations first so autocomplete feels fast */
const PRIORITY_COUNTRY_CODES = [
  "IN", "AE", "SG", "TH", "US", "GB", "FR", "AU", "MY", "ID", "MV", "LK", "NP", "HK",
  "CH", "DE", "IT", "ES", "NL", "CA", "NZ", "JP", "KR", "CN", "BT", "QA", "OM", "SA",
  "KW", "BH", "EG", "TR", "VN", "PH", "KH", "MU", "SC", "ZA", "PT", "GR", "AT", "BE",
];

const cityListByCountryCache = new Map<string, { at: number; cities: TboCityRow[] }>();
let countryCodesCache: { at: number; codes: string[] } | null = null;

function extractCityList(result: unknown): TboCityRow[] {
  const root = result as Record<string, unknown> | null;
  if (!root) return [];
  const raw =
    (root.CityList as unknown[]) ??
    (root.Cities as unknown[]) ??
    ((root.Response as Record<string, unknown> | undefined)?.CityList as unknown[]) ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const row = c as Record<string, unknown>;
      const Code = String(row.Code ?? row.code ?? "").trim();
      const Name = String(row.Name ?? row.name ?? "").trim();
      const CountryCode = String(row.CountryCode ?? row.countryCode ?? "").trim().toUpperCase();
      if (!Code || !Name) return null;
      return { Code, Name, CountryCode };
    })
    .filter((c): c is TboCityRow => c !== null);
}

function extractCountryCodes(result: unknown): string[] {
  const root = result as Record<string, unknown> | null;
  if (!root) return [];
  const raw =
    (root.CountryList as unknown[]) ??
    (root.Countries as unknown[]) ??
    ((root.Response as Record<string, unknown> | undefined)?.CountryList as unknown[]) ??
    [];
  if (!Array.isArray(raw)) return [];
  const codes = raw
    .map((c) => {
      const row = c as Record<string, unknown>;
      return String(row.Code ?? row.CountryCode ?? row.countryCode ?? "").trim().toUpperCase();
    })
    .filter((cc) => /^[A-Z]{2}$/.test(cc));
  return [...new Set(codes)];
}

async function getCachedCountryCodes(): Promise<string[]> {
  const now = Date.now();
  if (countryCodesCache && now - countryCodesCache.at < CITY_LIST_CACHE_TTL_MS) {
    return countryCodesCache.codes;
  }
  try {
    const result = await getCountryList();
    const codes = extractCountryCodes(result);
    if (codes.length) {
      countryCodesCache = { at: now, codes };
      return codes;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[hotel-static] CountryList failed:", msg);
  }
  const fallback = [...new Set([...PRIORITY_COUNTRY_CODES, ...TBO_CITY_LIST.map((c) => c.CountryCode)])];
  countryCodesCache = { at: now, codes: fallback };
  return fallback;
}

async function fetchCitiesForCountry(countryCode: string): Promise<TboCityRow[]> {
  const cc = countryCode.trim().toUpperCase();
  const now = Date.now();
  const cached = cityListByCountryCache.get(cc);
  if (cached && now - cached.at < CITY_LIST_CACHE_TTL_MS) {
    return cached.cities;
  }
  const result = await tboStaticPost("/CityList", { CountryCode: cc });
  const cities = extractCityList(result).map((c) => ({
    ...c,
    // Always enforce the requested country code — TBO occasionally returns rows
    // with a blank or different CountryCode in the CityList payload
    CountryCode: c.CountryCode && /^[A-Z]{2}$/.test(c.CountryCode) ? c.CountryCode : cc,
  }));
  cityListByCountryCache.set(cc, { at: now, cities });
  return cities;
}

function filterCitiesByQuery(cities: TboCityRow[], query: string): TboCityRow[] {
  const q = query.split(',')[0].trim().toLowerCase();
  if (!q) return [];
  
  // More precise matching - prioritize exact word matches
  const exactMatches = cities.filter((c) => {
    const cityName = c.Name.toLowerCase();
    // Split by spaces and check for exact word match
    const words = cityName.split(/\s+/);
    return words.some(word => word === q || word.startsWith(q));
  });
  
  // If we have exact matches, prefer those
  if (exactMatches.length > 0) return exactMatches;
  
  // Otherwise fall back to substring matching
  return cities.filter((c) => c.Name.toLowerCase().includes(q));
}

function rankCityMatches(cities: TboCityRow[], query: string): TboCityRow[] {
  const q = query.split(',')[0].trim().toLowerCase();
  return [...cities].sort((a, b) => {
    const an = a.Name.toLowerCase();
    const bn = b.Name.toLowerCase();
    const aStarts = an.startsWith(q) ? 0 : 1;
    const bStarts = bn.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.localeCompare(bn);
  });
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

async function searchCitiesInCountries(
  query: string,
  countryCodes: string[],
  maxResults: number
): Promise<TboCityRow[]> {
  const matches: TboCityRow[] = [];
  const seen = new Set<string>();

  const collect = (rows: TboCityRow[]) => {
    for (const row of rows) {
      const key = `${row.CountryCode}:${row.Code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(row);
      if (matches.length >= maxResults) return true;
    }
    return false;
  };

  await mapPool(countryCodes, CITY_SEARCH_CONCURRENCY, async (cc) => {
    if (matches.length >= maxResults) return;
    try {
      const cities = await fetchCitiesForCountry(cc);
      const filtered = filterCitiesByQuery(cities, query);
      collect(filtered);
    } catch {
      // Some countries may have no CityList data — skip
    }
  });

  return rankCityMatches(matches, query).slice(0, maxResults);
}

function fallbackCitySearch(query: string): TboCityRow[] {
  return rankCityMatches(filterCitiesByQuery(TBO_CITY_LIST, query), query).slice(
    0,
    GLOBAL_CITY_RESULT_LIMIT
  );
}

/**
 * POST /CityList — { CountryCode }
 * @param countryCode — 2-letter ISO code, or omit / pass "ALL" to search every country
 */
export async function getCityList(cityName: string, countryCode?: string) {
  const query = cityName.trim();
  const cc = countryCode?.trim().toUpperCase();

  // If a specific country is requested, ONLY search that country
  if (cc && cc !== "ALL") {
    try {
      const cities = await fetchCitiesForCountry(cc);
      const filtered = filterCitiesByQuery(cities, query);
      if (filtered.length) {
        console.log(`[hotel-static] Found ${filtered.length} cities in ${cc} matching "${query}"`);
        return {
          Status: { Code: 1, Description: "Success" },
          CityList: rankCityMatches(filtered, query),
          source: "tbo",
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[hotel-static] CityList failed for ${cc}:`, msg);
    }
    
    // Fallback to local data for this specific country only
    const fallback = fallbackCitySearch(query).filter((c) => c.CountryCode === cc);
    console.log(`[hotel-static] Using fallback: ${fallback.length} cities in ${cc} matching "${query}"`);
    return {
      Status: { Code: 1, Description: "Success" },
      CityList: fallback,
      source: fallback.length ? "fallback" : "tbo",
    };
  }

  // Global search (ALL or no country specified)
  try {
    const allCodes = await getCachedCountryCodes();
    const ordered = [
      ...PRIORITY_COUNTRY_CODES.filter((c) => allCodes.includes(c)),
      ...allCodes.filter((c) => !PRIORITY_COUNTRY_CODES.includes(c)),
    ];
    const globalMatches = await searchCitiesInCountries(
      query,
      ordered,
      GLOBAL_CITY_RESULT_LIMIT
    );
    if (globalMatches.length) {
      console.log(`[hotel-static] Global search: found ${globalMatches.length} cities matching "${query}"`);
      return {
        Status: { Code: 1, Description: "Success" },
        CityList: globalMatches,
        source: "tbo-global",
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[hotel-static] Global city search failed:", msg);
  }

  const fallbackResults = fallbackCitySearch(query);
  console.log(`[hotel-static] Using global fallback: ${fallbackResults.length} cities matching "${query}"`);
  return {
    Status: { Code: 1, Description: "Success" },
    CityList: fallbackResults,
    source: "fallback",
  };
}

/** POST /TBOHotelCodeList — { CityCode } */
export async function getHotelCodeListByCity(cityCode: string) {
  let finalCode = cityCode;
  // Extract just the numeric city code, discarding country prefix if present
  if (finalCode.includes(":")) {
    finalCode = finalCode.split(":")[1];
  }
  
  console.log(`[hotel-static] Fetching hotel codes for city: ${cityCode} (resolved to: ${finalCode})`);
  
  const result = await tboStaticPost("/TBOHotelCodeList", { CityCode: finalCode });
  
  // Log the response to help debug mismatches
  const hotelCount = Array.isArray(result?.HotelCodes) ? result.HotelCodes.length : 
                     Array.isArray((result as any)?.Hotels) ? (result as any).Hotels.length : 0;
  console.log(`[hotel-static] Received ${hotelCount} hotel codes for city ${finalCode}`);
  
  return result;
}

/** GET /HotelCodeList — all hotels (large) */
export async function getAllHotelCodeList() {
  return tboStaticGet("/HotelCodeList");
}

export async function getHotelStaticDetails(hotelCodes: string | string[]) {
  const codesArray = Array.isArray(hotelCodes) ? hotelCodes : hotelCodes.split(",");
  const cleanedCodes = codesArray.map(c => c.trim()).filter(Boolean);
  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < cleanedCodes.length; i += CHUNK_SIZE) {
    chunks.push(cleanedCodes.slice(i, i + CHUNK_SIZE).join(","));
  }

  const allStaticDetails: any[] = [];
  const CONCURRENCY = 20;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (chunkCodes) => {
        try {
          const res = await tboStaticPost("/Hoteldetails", { Hotelcodes: chunkCodes, Language: "en" });
          const details = (res as any)?.HotelDetails;
          if (Array.isArray(details)) {
            allStaticDetails.push(...details);
          }
        } catch (e) {
          console.error("Static details chunk failed", e);
        }
      })
    );
  }
  return { HotelDetails: allStaticDetails };
}

/* ================================================================== */
/* BOOKING API                                                        */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* Search  POST /Search                                               */
/*                                                                    */
/* IMPORTANT: TBO Search takes HotelCodes (comma-separated TBO hotel  */
/* codes), NOT a CityId. You must first call TBOHotelCodeList to get  */
/* hotel codes for a city, then pass them here in chunks of ≤100.    */
/* ------------------------------------------------------------------ */

export type HotelSearchInput = {
  hotelCodes:    string;   // comma-separated TBO hotel codes (max 100)
  checkIn:       string;   // YYYY-MM-DD
  checkOut:      string;   // YYYY-MM-DD
  rooms:         number;   // 1–9
  adults:        number;   // 1–8 per room
  children?:     number;   // 0–4 per room
  childrenAges?: number[]; // required if children > 0, each 0–18
  roomGuests?:   Array<{ adults: number; children: number; childrenAges: number[] }>;
  nationality?:  string;   // 2-letter ISO, default "IN"
  /** Optional; if omitted a new UUID is generated and echoed as `traceId` on the response */
  traceId?:      string;
};

export async function searchHotels(input: HotelSearchInput) {
  const {
    hotelCodes, checkIn, checkOut, rooms, adults,
    children = 0, childrenAges = [],
    roomGuests,
    nationality = "IN",
  } = input;

  validateDateRange(checkIn, checkOut);

  if (rooms < 1 || rooms > 9)     throw new Error("rooms must be between 1 and 9");

  let PaxRooms;
  if (roomGuests && roomGuests.length > 0) {
    PaxRooms = roomGuests.map((rg) => {
      if (rg.adults < 1 || rg.adults > 8) throw new Error("adults must be between 1 and 8 per room");
      if (rg.children < 0 || rg.children > 4) throw new Error("children must be between 0 and 4 per room");
      if (rg.children > 0 && rg.childrenAges.length !== rg.children) {
        throw new Error(`childrenAges must have exactly ${rg.children} entr${rg.children === 1 ? "y" : "ies"}`);
      }
      if (rg.childrenAges.some((age) => age < 0 || age > 18)) {
        throw new Error("each child age must be between 0 and 18");
      }
      return {
        Adults: rg.adults,
        Children: rg.children,
        ChildrenAges: rg.childrenAges.length > 0 ? rg.childrenAges : [],
      };
    });
  } else {
    if (adults < 1 || adults > 8)   throw new Error("adults must be between 1 and 8 per room");
    if (children < 0 || children > 4) throw new Error("children must be between 0 and 4 per room");
    if (children > 0 && childrenAges.length !== children) {
      throw new Error(`childrenAges must have exactly ${children} entr${children === 1 ? "y" : "ies"}`);
    }
    if (childrenAges.some((age) => age < 0 || age > 18)) {
      throw new Error("each child age must be between 0 and 18");
    }

    PaxRooms = Array.from({ length: rooms }, () => ({
      Adults:       adults,
      Children:     children,
      ChildrenAges: childrenAges.length > 0 ? childrenAges : [],
    }));
  }

  const traceId = (input.traceId && String(input.traceId).trim()) || randomUUID();
  const tokenId = await authenticate();

  const codesArray = hotelCodes.split(',').map(c => c.trim()).filter(Boolean);
  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < codesArray.length; i += CHUNK_SIZE) {
    chunks.push(codesArray.slice(i, i + CHUNK_SIZE).join(','));
  }

  const allHotelResults: any[] = [];
  let firstTraceId = traceId;
  let firstResponseRaw: any = null;

  // Process chunks concurrently (up to 5 at a time) to prevent TBO rate-limiting
  const CONCURRENCY = 5;
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < chunks.length; i++) {
    const chunkCodes = chunks[i];

    const p = (async () => {
      const chunkTraceId = randomUUID();
      let raw: any = null;
      let lastErr: any = null;

      // Retry logic: up to 3 attempts per chunk
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const searchPayload = {
            CheckIn:            toTboDate(checkIn),
            CheckOut:           toTboDate(checkOut),
            HotelCodes:         chunkCodes,
            GuestNationality:   nationality,
            NoOfRooms:          rooms,
            PaxRooms,
            ResponseTime:       23,
            IsDetailedResponse: false,
            Filters: {
              Refundable: false,
              NoOfRooms:  0,
              MealType:   0,
              OrderBy:    0,
              StarRating: 0,
              HotelName:  null,
            },
            TokenId:  tokenId,
            TraceId:  chunkTraceId,
          };

          raw = await tboPost("/Search", searchPayload);
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 3) throw err;
          await new Promise(res => setTimeout(res, attempt * 1000));
        }
      }

      if (!raw) throw lastErr;

      const echoed = (raw as any)?.Response?.TraceId || (raw as any)?.TraceId;
      const outTrace = typeof echoed === "string" && echoed.trim() ? echoed.trim() : chunkTraceId;

      if (!firstResponseRaw) firstResponseRaw = raw;
      if (i === 0) firstTraceId = outTrace;

      const results = (raw as any)?.Response?.HotelResult || (raw as any)?.HotelResult;
      if (Array.isArray(results)) {
        results.forEach((h: any) => {
          h._traceId = outTrace;
        });
        allHotelResults.push(...results);
      }
    })().catch((err) => {
      console.error(`[hotel-search] Chunk ${i} failed:`, err);
    });

    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= CONCURRENCY) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);

  // Deduplicate hotels by HotelCode (TBO Sandbox sometimes returns the same hotels across different chunks)
  const uniqueHotelsMap = new Map();
  for (const h of allHotelResults) {
    if (h && (h.HotelCode || h.hotelCode)) {
      const code = h.HotelCode || h.hotelCode;
      if (!uniqueHotelsMap.has(code)) {
        uniqueHotelsMap.set(code, h);
      }
    }
  }
  const uniqueHotelResults = Array.from(uniqueHotelsMap.values());

  // Construct a merged response matching the expected format
  const mergedResponse = {
    ...((firstResponseRaw as Record<string, unknown>) || {}),
    traceId: firstTraceId,
    Response: {
      ...((firstResponseRaw as any)?.Response || {}),
      ResponseStatus: 1,
      TraceId: firstTraceId,
      HotelResult: uniqueHotelResults
    },
    HotelResult: uniqueHotelResults
  };

  return mergedResponse;
}

/* ------------------------------------------------------------------ */
/* searchHotelsStream — fires small batches and streams results        */
/* onBatch is called as each TBO /Search responds (no waiting for all) */
/* ------------------------------------------------------------------ */
export async function searchHotelsStream(
  input: HotelSearchInput,
  onBatch: (hotels: any[], traceId: string) => void,
  onDone: () => void,
  onError: (err: any) => void,
) {
  const {
    hotelCodes, checkIn, checkOut, rooms, adults,
    children = 0, childrenAges = [],
    roomGuests,
    nationality = "IN",
  } = input;

  validateDateRange(checkIn, checkOut);

  let PaxRooms;
  if (roomGuests && roomGuests.length > 0) {
    PaxRooms = roomGuests.map((rg) => ({
      Adults: rg.adults,
      Children: rg.children,
      ChildrenAges: rg.childrenAges.length > 0 ? rg.childrenAges : [],
    }));
  } else {
    PaxRooms = Array.from({ length: rooms }, () => ({
      Adults: adults,
      Children: children,
      ChildrenAges: childrenAges.length > 0 ? childrenAges : [],
    }));
  }

  const traceId = (input.traceId && String(input.traceId).trim()) || randomUUID();
  const tokenId = await authenticate();

  const codesArray = hotelCodes.split(',').map(c => c.trim()).filter(Boolean);
  // Use smaller chunks (20 codes each) so each TBO call is faster
  const STREAM_CHUNK_SIZE = 20;
  const chunks: string[] = [];
  for (let i = 0; i < codesArray.length; i += STREAM_CHUNK_SIZE) {
    chunks.push(codesArray.slice(i, i + STREAM_CHUNK_SIZE).join(','));
  }

  const CONCURRENCY = 5;
  const executing = new Set<Promise<void>>();

  const runChunk = async (chunkCodes: string, idx: number) => {
    // Use the SAME traceId for every chunk so all hotels share one traceId.
    // TBO requires prebook to use the traceId from the search that returned
    // that hotel — a single shared traceId satisfies this for the whole session.
    try {
      const searchPayload = {
        CheckIn:            toTboDate(checkIn),
        CheckOut:           toTboDate(checkOut),
        HotelCodes:         chunkCodes,
        GuestNationality:   nationality,
        NoOfRooms:          rooms,
        PaxRooms,
        ResponseTime:       23,
        IsDetailedResponse: false,
        Filters: { Refundable: false, NoOfRooms: 0, MealType: 0, OrderBy: 0, StarRating: 0, HotelName: null },
        TokenId:  tokenId,
        TraceId:  traceId,  // shared across all chunks
      };

      const raw: any = await tboPost("/Search", searchPayload);
      const echoed = raw?.Response?.TraceId || raw?.TraceId;
      const outTrace = typeof echoed === "string" && echoed.trim() ? echoed.trim() : traceId;

      const results: any[] = raw?.Response?.HotelResult || raw?.HotelResult || [];
      results.forEach((h: any) => { h._traceId = outTrace; });

      if (results.length > 0) {
        onBatch(results, outTrace);
      }
    } catch (err) {
      console.error(`[hotel-search-stream] Chunk ${idx} failed:`, err);
      // Don't call onError for individual chunk failures — just skip
    }
  };

  for (let i = 0; i < chunks.length; i++) {
    const p = runChunk(chunks[i], i).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= CONCURRENCY) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);
  onDone();
}

/* ------------------------------------------------------------------ */
/* PreBook  POST /PreBook                                             */
/* BookingCode (from Search) + TokenId + TraceId (same as Search)   */
/* ------------------------------------------------------------------ */

export async function preBookHotel(input: {
  bookingCode: string;
  /** Must match traceId returned from POST /search for this itinerary */
  traceId: string;
  /** Optional; defaults to fresh Authenticate() using cached token when valid */
  tokenId?: string;
}) {
  const traceId = String(input.traceId || "").trim();
  if (!traceId) throw new Error("traceId is required (pass traceId from the hotel search response)");

  const tokenId = input.tokenId?.trim() || (await authenticate());

  // PreBook is a read-only price/policy check — only BookingCode, TokenId, TraceId.
  // Do NOT include IsVoucherBooking, HotelRoomsDetails, GuestNationality or any booking
  // intent fields — they cause TBO to treat this as an actual booking and check balance.
  const preBookPayload = {
    BookingCode: input.bookingCode,
    TokenId:     tokenId,
    PaymentMode: "Limit",
  };

  console.log("[hotel-prebook] Sending to TBO:", JSON.stringify({
    ...preBookPayload,
    TokenId: `${String(tokenId).slice(0, 8)}…`,
  }, null, 2));

  // Use a shorter timeout for prebook (30s) — it's a price-check, not a booking
  let result: any;
  try {
    result = await tboPostWithClient(httpHotel, "/PreBook", preBookPayload, { timeout: 30_000 });
  } catch (err: any) {
    // Log the full raw TBO error response so it's visible in the terminal
    // exactly like the TBO API docs show (HotelResult, Rooms, CancelPolicies etc.)
    console.error("[hotel-prebook] TBO ERROR RESPONSE:", JSON.stringify(
      err?.response?.data ?? { message: err?.message ?? "Unknown error" },
      null, 2
    ));
    throw err;
  }
  const normalizedResult = normalizePreBookCancellationResponse(result);
  console.log("[hotel-prebook] TBO RAW RESPONSE:", JSON.stringify(normalizedResult, null, 2));
  return normalizedResult;

}

/* ------------------------------------------------------------------ */
/* Book  POST /book  (same affiliate base as Search/PreBook)          */
/* ------------------------------------------------------------------ */

export type BookGuest = {
  title:       "Mr" | "Mrs" | "Ms" | "Miss" | "Mstr";
  firstName:   string;
  middleName?: string;
  lastName:    string;
  paxType:     1 | 2;      // 1=Adult, 2=Child
  leadGuest?:  boolean;
  age?:        number;     // required for children (≤12)
  passportNo?: string;
  passportIssueDate?: string;
  passportExpDate?:   string;
  pan?:        string;
};

export type ArrivalTransport = {
  arrivalTransportType: 0 | 1;
  transportInfoId:      string;
  time:                 string;
};

export type DepartureTransport = {
  departureTransportType: 0 | 1;
  transportInfoId:        string;
  time:                   string;
};

export type BookInput = {
  bookingCode:              string;
  /** Multi-room: one BookingCode per room. Fallback to [bookingCode] for single room. */
  bookingCodes?:            string[];
  guestNationality:         string;
  /** Same traceId as Search / PreBook for this booking */
  traceId:                  string;
  /** Optional; defaults to Authenticate() */
  tokenId?:                 string;
  /** End-user IP address — required by TBO /Book */
  endUserIp?:               string;
  isVoucherBooking?:        boolean;
  guests:                   BookGuest[];
  contact:                  { email: string; mobile: string };
  /**
   * Same values as POST `/search` (per-room occupancy). Required when `rooms` > 1.
   * When omitted with `rooms` === 1, adults/children are inferred from `guests` paxType counts.
   */
  rooms?:                   number;
  /** Adults per room (1–8), same as search */
  adults?:                  number;
  /** Children per room (0–4), same as search — default 0 */
  children?:                number;
  /** Pass through from PreBook if true — service will also auto-detect from PreBook response */
  isPackageFare?:           boolean;
  /** Pass through from PreBook if true — service will also auto-detect from PreBook response */
  isPackageDetailsMandatory?: boolean;
  arrivalTransport?:        ArrivalTransport;
  departureTransport?:      DepartureTransport;
  /** Fallback NetAmount from frontend priceDetails — used if PreBook fails with insufficient balance */
  netAmountFallback?:       number;
};

export async function bookHotel(input: BookInput) {
  const {
    bookingCode, bookingCodes: inputBookingCodes, guestNationality, traceId: flowTraceId,
    tokenId: inputTokenId,
    endUserIp,
    isVoucherBooking = true,
    guests, contact,
    isPackageFare,
    isPackageDetailsMandatory,
    arrivalTransport,
    departureTransport,
  } = input;

  const traceId = String(flowTraceId || "").trim();
  if (!traceId) throw new Error("traceId is required (same value as search and prebook for this booking)");

  // Resolve booking codes — multi-room sends bookingCodes[], single-room sends bookingCode
  const resolvedBookingCodes: string[] =
    Array.isArray(inputBookingCodes) && inputBookingCodes.length > 0
      ? inputBookingCodes.map(c => String(c).trim()).filter(Boolean)
      : [String(bookingCode).trim()];

  if (resolvedBookingCodes.length === 0) throw new Error("At least one bookingCode is required");

  const tokenId = inputTokenId?.trim() || (await authenticate());

  if (!guests.length) throw new Error("At least one guest is required");
  const leadCount = guests.filter((g) => g.leadGuest).length;
  if (leadCount !== 1) throw new Error("Exactly one guest must be the lead guest");

  if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    throw new Error("Invalid contact email address");
  }
  if (!contact.mobile || !/^\+?[\d\s\-]{7,15}$/.test(contact.mobile)) {
    throw new Error("Invalid contact mobile number");
  }

  // ── Occupancy → HotelRoomsDetails ─────────────────────────────────────────
  // roomsN is derived from bookingCodes count (most reliable) or explicit rooms field
  const roomsN = resolvedBookingCodes.length > 1
    ? resolvedBookingCodes.length
    : (input.rooms != null && String(input.rooms).trim() !== "" ? Number(input.rooms) : 1);

  if (!Number.isInteger(roomsN) || roomsN < 1 || roomsN > 9) {
    throw new Error("rooms must be an integer between 1 and 9 (same as hotel search)");
  }

  const inferredAdults   = guests.filter((g) => g.paxType === 1).length;
  const inferredChildren = guests.filter((g) => g.paxType === 2).length;

  let adultsPerRoom =
    input.adults != null && String(input.adults).trim() !== "" ? Number(input.adults) : NaN;
  let childrenPerRoom =
    input.children != null && String(input.children).trim() !== ""
      ? Number(input.children)
      : 0;

  if (!Number.isFinite(adultsPerRoom) || adultsPerRoom < 1 || adultsPerRoom > 8) {
    throw new Error(
      "`adults` (per room, 1–8) is required — use the same value as hotel search. Send `children` (per room, 0–4) if any, `rooms` if not 1."
    );
  }

  if (!Number.isInteger(childrenPerRoom) || childrenPerRoom < 0 || childrenPerRoom > 4) {
    throw new Error("children must be an integer between 0 and 4 per room (same as hotel search)");
  }

  const paxPerRoom = adultsPerRoom + childrenPerRoom;
  if (paxPerRoom < 1) throw new Error("Each room needs at least one guest (adults + children per room)");

  // ── Guest count validation ──────────────────────────────────────────────────
  // Frontend sends per-room occupancy once (adults + children), NOT multiplied by rooms.
  // e.g. 2 rooms × 2 adults × 1 child → 3 guests sent (not 6).
  const expectedAdults   = adultsPerRoom;
  const expectedChildren = childrenPerRoom;

  if (inferredAdults !== expectedAdults || inferredChildren !== expectedChildren) {
    throw new Error(
      `Guest paxType counts must match search: need ${expectedAdults} adult(s) (paxType 1) and ${expectedChildren} child(ren) (paxType 2); got ${inferredAdults} adult(s) and ${inferredChildren} child(ren).`
    );
  }

  const leadPan = guests.find(g => g.leadGuest)?.pan;
  const guestToTboPassenger = (g: BookGuest) => ({
    Title:          g.title,
    FirstName:      g.firstName.trim(),
    MiddleName:     g.middleName?.trim() ?? "",
    LastName:       g.lastName.trim(),
    Phoneno:        g.leadGuest ? contact.mobile : "",
    Email:          g.leadGuest ? contact.email  : "",
    PaxType:        g.paxType,
    LeadPassenger:  g.leadGuest ?? false,
    ...(g.age !== undefined ? { Age: g.age } : {}),
    ...(g.passportNo        ? { PassportNo: g.passportNo } : {}),
    ...(g.passportIssueDate ? { PassportIssueDate: g.passportIssueDate } : {}),
    ...(g.passportExpDate   ? { PassportExpDate: g.passportExpDate } : {}),
    ...(g.pan ? { PAN: g.pan, Pan: g.pan } : leadPan ? { PAN: leadPan, Pan: leadPan } : {}),
  });

  // ── Step 1: Call PreBook to get authoritative pricing from TBO ──────────────
  // Never trust pricing from the frontend. Always fetch fresh from TBO so the
  // NetAmount in the /Book request exactly matches what TBO expects.
  console.log("[hotel-book] Calling PreBook to fetch authoritative pricing...", {
    bookingCode,
    traceId,
  });

  let preBookRaw: any;
  // For multi-room, PreBook each BookingCode separately and merge the rooms.
  // TBO PreBook is per-BookingCode — sending only one code returns only one room's fare.
  if (resolvedBookingCodes.length > 1) {
    const allRooms: unknown[] = [];
    let mergedRoot: Record<string, unknown> = {};

    await Promise.all(resolvedBookingCodes.map(async (code) => {
      try {
        const pb = await tboPost("/PreBook", { BookingCode: code, TokenId: tokenId, TraceId: traceId, IsVoucherBooking: false, PaymentMode: "Limit" });
        const root = unwrapTboHotelPayload(pb) ?? (pb as Record<string, unknown>);
        const hotels = coerceHotelResultArray(root.HotelResult ?? root.hotelResult);
        for (const hr of hotels) {
          const roomsRaw = (hr as Record<string, unknown>).Rooms ?? (hr as Record<string, unknown>).rooms;
          if (Array.isArray(roomsRaw)) allRooms.push(...roomsRaw);
        }
        if (!mergedRoot.ValidationInfo) mergedRoot = { ...root };
      } catch (e: any) {
        const msg: string = e?.message ?? "";
        if (
          (msg.toLowerCase().includes("insufficient balance") || msg.toLowerCase().includes("insufficient fund")) &&
          input.netAmountFallback != null && Number.isFinite(input.netAmountFallback)
        ) {
          // handled below — fall through
        } else {
          throw Object.assign(new Error(`PreBook failed for code ${code}: ${msg}`), { code: e.code });
        }
      }
    }));

    if (allRooms.length > 0) {
      // Reconstruct a synthetic preBookRaw with all rooms merged under one HotelResult
      preBookRaw = {
        ...mergedRoot,
        HotelResult: [{ BookingCode: resolvedBookingCodes[0], Rooms: allRooms }],
      };
    } else if (input.netAmountFallback != null && Number.isFinite(input.netAmountFallback)) {
      console.warn(`[hotel-book] All PreBooks returned Insufficient Balance — using netAmountFallback=${input.netAmountFallback}`);
      preBookRaw = {
        HotelResult: [{
          BookingCode: resolvedBookingCodes[0],
          Rooms: resolvedBookingCodes.map(code => ({ BookingCode: code, TotalFare: input.netAmountFallback! / resolvedBookingCodes.length, NetAmount: input.netAmountFallback! / resolvedBookingCodes.length })),
        }],
      };
    } else {
      throw new Error("PreBook failed for all rooms — no pricing data available");
    }
  } else {
    // Single room — original flow
    const preBookBody: Record<string, unknown> = {
      BookingCode:      bookingCode,
      TokenId:          tokenId,
      TraceId:          traceId,
      IsVoucherBooking: false,
      PaymentMode:      "Limit",
    };

    try {
      preBookRaw = await tboPost("/PreBook", preBookBody as Record<string, any>);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (
        (msg.toLowerCase().includes("insufficient balance") || msg.toLowerCase().includes("insufficient fund")) &&
        input.netAmountFallback != null && Number.isFinite(input.netAmountFallback)
      ) {
        console.warn(`[hotel-book] PreBook returned Insufficient Balance — using netAmountFallback=${input.netAmountFallback} to proceed with /Book`);
        preBookRaw = {
          HotelResult: [{ BookingCode: bookingCode, Rooms: [{ BookingCode: bookingCode, TotalFare: input.netAmountFallback, NetAmount: input.netAmountFallback }] }],
        };
      } else {
        throw Object.assign(new Error(`PreBook failed before Book: ${msg}`), { code: err.code });
      }
    }
  }

  // TBO PreBook response shape (per apidoc.tektravels.com/hotelnew/HotelPreBook_json.aspx):
  //   HotelResult[].Rooms[].TotalFare   ← NetAmount for /Book (may be under Response.*)
  //   Rooms[].BookingCode               ← may be updated by PreBook; match requested code when possible
  const picked = pickPreBookRoomForBook(preBookRaw, String(bookingCode).trim());
  const hotelResult = picked?.hotelResult as Record<string, unknown> | undefined;
  const room        = picked?.room;

  if (!picked || picked.totalFare === undefined || !Number.isFinite(picked.totalFare)) {
    const status = (preBookRaw as Record<string, unknown>)?.Status as Record<string, unknown> | undefined;
    const statusHint =
      status && typeof status === "object"
        ? ` TBO Status: ${String(status.Code ?? "?")} — ${String(status.Description ?? "")}.`
        : "";
    console.error("[hotel-book] Could not extract TotalFare from PreBook response. Full response:", JSON.stringify(preBookRaw, null, 2));
    throw new Error(
      "Could not read room price from PreBook (session may have expired, or the selected room is no longer available)." +
        statusHint +
        " Try searching again and complete checkout without long delays."
    );
  }

  // Use the BookingCode from PreBook room if TBO updated it; for multi-room use first code
  const primaryBookingCode = resolvedBookingCodes[0];
  const finalBookingCode = (room?.BookingCode != null ? String(room.BookingCode).trim() : "") || primaryBookingCode;

  const bookingCodesSet = new Set(
    [primaryBookingCode, String(finalBookingCode).trim(), ...resolvedBookingCodes].filter(Boolean)
  );
  const aggregated = aggregateFareForRooms(hotelResult, bookingCodesSet, roomsN, {
    totalFare: picked.totalFare,
    totalTax:  picked.totalTax,
  });
  const tboTotalFareRaw = aggregated.totalFare;
  const tboTotalTaxRaw =
    aggregated.totalTax !== undefined && Number.isFinite(aggregated.totalTax)
      ? aggregated.totalTax
      : undefined;

  if (roomsN > 1 && aggregated.totalFare !== picked.totalFare) {
    console.log("[hotel-book] Multi-room NetAmount aggregation:", {
      roomsN,
      pickedSingleRoomFare: picked.totalFare,
      aggregatedNetAmount:  aggregated.totalFare,
      finalBookingCode,
    });
  }

  console.log("[hotel-book] PreBook response pricing:", {
    rawHotelResult:     hotelResult ? "(present)" : "(missing)",
    rawRoom:            room        ? "(present)" : "(missing)",
    TotalFare:          tboTotalFareRaw,
    TotalTax:           tboTotalTaxRaw,
    preBookBookingCode: room?.BookingCode,
    ValidationInfo:   (unwrapTboHotelPayload(preBookRaw) ?? preBookRaw)?.ValidationInfo,
  });

  if (!Number.isFinite(tboTotalFareRaw)) {
    console.error("[hotel-book] Invalid aggregated fare. Full response:", JSON.stringify(preBookRaw, null, 2));
    throw new Error(
      "Could not compute a valid NetAmount from PreBook. Try searching again and complete checkout without long delays."
    );
  }

  const envelope       = unwrapTboHotelPayload(preBookRaw) ?? (preBookRaw as Record<string, unknown>);
  const validationInfo = (envelope?.ValidationInfo as Record<string, unknown>) ?? {};
  const tboIsPackageFare            = validationInfo.PackageFare            ?? false;
  const tboIsPackageDetailsMandatory = validationInfo.PackageDetailsMandatory ?? false;

  // Build TBO passengers — LeadPassenger driven by the actual leadGuest flag, not array index.
  // guestToTboPassenger already wires email/phone on the lead guest.
  const tboPassengers = guests.map((g) => ({
    ...guestToTboPassenger(g),
    LeadPassenger: g.leadGuest === true,
  }));

  // Each room gets the full passenger list with its own BookingCode
  const HotelRoomsDetails = resolvedBookingCodes.map((roomCode) => ({
    BookingCode:    roomCode,
    HotelPassenger: tboPassengers,
  }));

  const requestedBookingMode = Number(process.env.TBO_HOTEL_REQUESTED_BOOKING_MODE ?? 5);
  const bookingMode = Number.isFinite(requestedBookingMode) ? requestedBookingMode : 5;

  const strategyCandidates: { label: string; net: number; taxes?: number }[] = [
    { label: "aggregated-no-taxes", net: tboTotalFareRaw },
  ];
  if (tboTotalTaxRaw !== undefined && Number.isFinite(tboTotalTaxRaw)) {
    strategyCandidates.push({ label: "aggregated-with-taxes", net: tboTotalFareRaw, taxes: tboTotalTaxRaw });
    const netExcl = tboTotalFareRaw - tboTotalTaxRaw;
    if (Number.isFinite(netExcl) && netExcl > 0.000001) {
      strategyCandidates.push({
        label: "aggregated-net-excl-taxes-split",
        net:   netExcl,
        taxes: tboTotalTaxRaw,
      });
    }
  }
  if (picked.totalFare !== tboTotalFareRaw || roomsN > 1) {
    strategyCandidates.push({ label: "picked-row-no-taxes", net: picked.totalFare });
    if (tboTotalTaxRaw !== undefined && Number.isFinite(tboTotalTaxRaw)) {
      strategyCandidates.push({ label: "picked-row-with-taxes", net: picked.totalFare, taxes: tboTotalTaxRaw });
    }
  }
  const strategies = dedupeBookStrategies(strategyCandidates);

  // Pin ClientReferenceId across all retry strategies — same booking attempt
  const clientReferenceId = `pt-${randomUUID().replace(/-/g, "")}`.slice(0, 40);

  const buildBookBody = (net: number, taxes?: number): Record<string, any> => {
    const b: Record<string, any> = {
      BookingCode:            finalBookingCode,
      GuestNationality:       guestNationality,
      IsVoucherBooking:       isVoucherBooking,
      HotelRoomsDetails,
      EndUserIp:              resolveBookingEndUserIp(endUserIp),
      TokenId:                tokenId,
      TraceId:                traceId,
      NetAmount:              net,
      RequestedBookingMode:   bookingMode,
      ClientReferenceId:      clientReferenceId,
    };
    
    // Some versions of the TBO API expect PAN at the root level instead of/in addition to the passenger level
    const leadPan = guests.find(g => g.leadGuest)?.pan;
    if (leadPan) {
      b.PAN = leadPan;
      b.PanNumber = leadPan;
      b.Pan = leadPan;
    }
    
    if (taxes !== undefined && Number.isFinite(taxes)) b.Taxes = taxes;
    b.IsPackageFare             = isPackageFare             !== undefined ? isPackageFare             : tboIsPackageFare;
    b.IsPackageDetailsMandatory = isPackageDetailsMandatory !== undefined ? isPackageDetailsMandatory : tboIsPackageDetailsMandatory;
    if (arrivalTransport) {
      b.ArrivalTransport = {
        ArrivalTransportType: arrivalTransport.arrivalTransportType,
        TransportInfoId:      arrivalTransport.transportInfoId,
        Time:                 arrivalTransport.time,
      };
    }
    if (departureTransport) {
      b.DepartureTransport = {
        DepartureTransportType: departureTransport.departureTransportType,
        TransportInfoId:        departureTransport.transportInfoId,
        Time:                   departureTransport.time,
      };
    }
    return b;
  };

  let lastBookErr: any;
  for (const strat of strategies) {
    const body = buildBookBody(strat.net, strat.taxes);
    console.log("[hotel-book] ─── Attempting TBO /Book ───");
    console.log("[hotel-book] Strategy:", strat.label);
    console.log("[hotel-book] Payload sent to TBO:", JSON.stringify(body, null, 2));
    
    try {
      const tboResponse = await tboPostWithClient(httpHotelBook, "/Book/", body);
      console.log("[hotel-book] ✅ TBO /Book success. Raw TBO response:", JSON.stringify(tboResponse, null, 2));
      return tboResponse;
    } catch (e: any) {
      lastBookErr = e;
      console.error(`[hotel-book] ❌ TBO /Book failed for strategy "${strat.label}":`, e.message);
      console.error(`[hotel-book] Error details:`, { message: e.message, tboCode: e.tboCode, stack: e.stack });
      if (!isInvalidNetAmountMessage(e?.message || "")) throw e;
      console.warn(`[hotel-book] Will retry with next pricing strategy (if available)...`);
    }
  }
  throw lastBookErr;
}

/* ------------------------------------------------------------------ */
/* GetBookingDetails  POST /GetBookingDetails                         */
/* Uses the Book host (HotelBE) — same as /Book                      */
/* ------------------------------------------------------------------ */

export async function getHotelBookingDetail(input: {
  bookingId: string;
}) {
  const tokenId = await authenticate();
  return tboPostWithClient(httpHotelBook, "/GetBookingDetails/", {
    BookingId: input.bookingId,
    TokenId:   tokenId,
  });
}

/**
 * Hotel Cancel — two-step flow per hotelnew API docs:
 *   1. POST /SendChangeRequest  → ChangeRequestId
 *   2. POST /GetChangeRequestStatus → refund amount
 *
 * Docs: https://apidoc.tektravels.com/hotelnew/HotelSendChange.aspx
 * Host: https://HotelBE.tektravels.com/hotelservice.svc/rest
 * Auth: Basic Auth header (agency credentials) — NO BookingMode field
 */
export async function cancelHotelBooking(input: {
  bookingId:    string;
  requestType?: 4;     // 4 = HotelCancel (only valid value per docs)
  remarks?:     string;
}) {
  const tokenId    = await authenticate();
  const endUserIp  = resolveBookingEndUserIp();
  const authHeader = getBookingAuthHeader();

  const cancelHeaders = {
    "Content-Type": "application/json",
    Accept:         "application/json",
    Authorization:  authHeader,
  };

  // Step 1 — SendChangeRequest
  // Host: https://HotelBE.tektravels.com/hotelservice.svc/rest
  // No BookingMode field — that belongs to the older /hotel API, not hotelnew
  console.log(`[hotel-cancel] Step1 SendChangeRequest BookingId=${input.bookingId}`);
  const sendPayload = {
    EndUserIp:   endUserIp,
    TokenId:     tokenId,
    BookingId:   Number(input.bookingId),
    RequestType: input.requestType ?? 4,
    Remarks:     input.remarks || "Cancelled by user",
  };

  let sendResp: any;
  try {
    const { data } = await httpHotelCancel.post("/SendChangeRequest", sendPayload, {
      headers: cancelHeaders,
    });
    sendResp = data;
  } catch (err: any) {
    const status = err?.response?.status;
    const body   = err?.response?.data;
    const msg    = body?.Error?.ErrorMessage || body?.error || err.message || "SendChangeRequest failed";
    console.error("[hotel-cancel] SendChangeRequest HTTP error", { status, body });
    throw new Error(`TBO SendChangeRequest failed: ${msg}`);
  }

  console.log("[hotel-cancel] SendChangeRequest response:", JSON.stringify(sendResp, null, 2));

  const innerSendResp = sendResp?.HotelChangeRequestResult || sendResp || {};

  // Check for errors
  const errObj = innerSendResp.Error;
  if (errObj?.ErrorCode && errObj.ErrorCode !== 0) {
    throw new Error(`TBO cancel rejected: ${errObj.ErrorMessage || `ErrorCode=${errObj.ErrorCode}`}`);
  }
  if (innerSendResp.ResponseStatus !== undefined && Number(innerSendResp.ResponseStatus) !== 1) {
    throw new Error(`TBO cancel failed: ResponseStatus=${innerSendResp.ResponseStatus}`);
  }

  const changeRequestId     = innerSendResp.ChangeRequestId;
  const changeRequestStatus = innerSendResp.ChangeRequestStatus;

  if (changeRequestId == null) {
    throw new Error("TBO did not return a ChangeRequestId — cancel may not have been accepted");
  }

  // Step 2 — GetChangeRequestStatus (poll up to 5 times, 3s apart)
  console.log(`[hotel-cancel] Step2 GetChangeRequestStatus ChangeRequestId=${changeRequestId}`);
  let statusResp: any;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { data } = await httpHotelCancel.post("/GetChangeRequestStatus", {
        EndUserIp:       endUserIp,
        TokenId:         tokenId,
        ChangeRequestId: Number(changeRequestId),
      }, { headers: cancelHeaders });
      statusResp = data;
    } catch (err: any) {
      console.warn(`[hotel-cancel] GetChangeRequestStatus attempt ${attempt} failed:`, err.message);
      if (attempt === 5) break;
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    console.log(`[hotel-cancel] GetChangeRequestStatus attempt ${attempt}:`, JSON.stringify(statusResp, null, 2));
    const innerStatusResp = statusResp?.HotelChangeRequestStatusResult || statusResp?.HotelChangeRequestResult || statusResp || {};
    const crStatus = Number(innerStatusResp.ChangeRequestStatus ?? -1);
    if (crStatus === 3 || crStatus === 4) break;  // 3=Processed, 4=Rejected
    if (attempt < 5) await new Promise(r => setTimeout(r, 3000));
  }

  const innerStatusResp = statusResp?.HotelChangeRequestStatusResult || statusResp?.HotelChangeRequestResult || statusResp || {};
  return {
    sendChangeRequest:      sendResp,
    getChangeRequestStatus: statusResp ?? null,
    changeRequestId,
    changeRequestStatus:    statusResp?.ChangeRequestStatus ?? changeRequestStatus,
    cancellationCharge:     statusResp?.CancellationCharge  ?? null,
    refundAmount:           statusResp?.RefundedAmount ?? statusResp?.RefundAmount ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* GetHotelVoucher  POST /GetHotelVoucher                             */
/* Retrieve voucher/e-ticket for a confirmed booking                  */
/* Uses the Book host (HotelBE) — same as /Book                      */
/* ------------------------------------------------------------------ */

export async function getHotelVoucher(input: {
  bookingId: string;
  endUserIp?: string;
}) {
  const tokenId = await authenticate();
  const endUserIp = resolveBookingEndUserIp(input.endUserIp);
  
  console.log(`[hotel-voucher] Fetching voucher for booking: ${input.bookingId}`);
  
  return tboPostWithClient(httpHotelBook, "/GetHotelVoucher/", {
    BookingId: input.bookingId,
    EndUserIp: endUserIp,
    TokenId:   tokenId,
  });
}


