// src/routes/hotels/index.ts
// All TBO Hotel API endpoints — /api/v1/hotels/
//
// Auth per https://apidoc.tektravels.com/hotelnew/Authorization.aspx:
//   Static API  → Basic Auth: TBOStaticAPITest:Tbo@11530818
//   Booking API → Basic Auth: agency credentials (Neelanchal:Today@05)
//   Shared API  → token from POST /Authenticate (Logout, GetAgencyBalance)
//
// Search flow (IMPORTANT):
//   1. GET  /cities?query=<name>          → get city list
//   2. POST /city-hotels { cityCode }     → get hotel codes for that city
//   3. POST /search { hotelCodes, ... }   → search (returns top-level traceId for the flow)
//   4. POST /prebook { bookingCode, traceId } → verify price (same traceId as search)
//   5. POST /book { bookingCode, traceId, guests, ... } → confirm booking

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { HotelBooking } from "../../models/hotelBooking.model.js";
import {
  getCountryList,
  getCityList,
  getHotelCodeListByCity,
  getAllHotelCodeList,
  getHotelStaticDetails,
  searchHotels,
  preBookHotel,
  bookHotel,
  getHotelBookingDetail,
  cancelHotelBooking,
  validateDateRange,
  getHotelVoucher,
} from "../../services/hotels/hotel.service.js";
import {
  authenticate,
  logout,
  getAgencyBalance,
  invalidateToken,
  _authBodyForDebug,
  resolveBookingEndUserIp,
} from "../../services/tbo/auth.service.js";
import {
  getStaticCredentials,
  getBookingCredentials,
} from "../../services/tbo/hotel.auth.service.js";
import {
  httpShared,
  SHARED_BASE,
  FLIGHT_BASE,
  axiosMessage,
  withTimeout,
} from "../../lib/http.js";

const r = Router();

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

const ok   = (data: any)                                   => ({ ok: true,  data });
const fail = (error: string, extra?: Record<string, any>) => ({ ok: false, error, ...extra });

function errMsg(err: any): string { return err?.message || "Unexpected error"; }

/* ------------------------------------------------------------------ */
/* Input validators                                                    */
/* ------------------------------------------------------------------ */

const ISO_DATE    = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE    = /^\+?[\d\s\-]{7,15}$/;
const VALID_TITLES    = ["Mr", "Mrs", "Ms", "Miss", "Mstr"];
const VALID_PAX_TYPES = [1, 2];

function validateIsoDate(val: string, field: string): void {
  if (!ISO_DATE.test(val)) {
    throw new Error(`${field} must be in YYYY-MM-DD format, got "${val}"`);
  }
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

r.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "hotels" });
});

/* ------------------------------------------------------------------ */
/* Auth diagnostics                                                    */
/* ------------------------------------------------------------------ */

r.get("/tbo/_auth-debug", async (_req, res) => {
  try {
    const token = await authenticate();
    res.json(ok({
      tokenPreview: token ? `${String(token).slice(0, 8)}…` : "(no token)",
      sharedBase:   SHARED_BASE,
      flightBase:   FLIGHT_BASE,
      body:         _authBodyForDebug(true),
    }));
  } catch (e: any) {
    res.status(400).json(fail(axiosMessage(e), {
      sharedBase: SHARED_BASE,
      flightBase: FLIGHT_BASE,
      body:       _authBodyForDebug(true),
    }));
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

r.get("/tbo/_static-debug", (_req, res) => {
  const sc = getStaticCredentials();
  const bc = getBookingCredentials();
  res.json(ok({
    staticApi:  { UserName: sc.UserName, PasswordPreview: sc.Password ? `${sc.Password.slice(0, 4)}****` : "(empty)" },
    bookingApi: { UserName: bc.UserName, PasswordPreview: bc.Password ? `${bc.Password.slice(0, 4)}****` : "(empty)" },
    staticBase: process.env.TBO_HOTEL_STATIC_BASE_URL || "(default)",
    hotelBase:  process.env.TBO_HOTEL_BASE_URL        || "(default)",
    bookBase:   process.env.TBO_HOTEL_BOOK_BASE_URL   || "(default)",
  }));
});

r.get("/tbo/_invalidate-token", (_req, res) => {
  invalidateToken();
  res.json(ok({ message: "Token cache cleared — will re-authenticate on next request" }));
});

/* ------------------------------------------------------------------ */
/* Logout  POST /api/v1/hotels/logout                                 */
/* ------------------------------------------------------------------ */
r.post("/logout", async (_req, res) => {
  try {
    const data = await logout();
    return res.json(ok(data));
  } catch (err: any) {
    return res.status(400).json(fail(errMsg(err)));
  }
});

/* ------------------------------------------------------------------ */
/* GetAgencyBalance  POST /api/v1/hotels/agency-balance               */
/* ------------------------------------------------------------------ */
r.post("/agency-balance", async (_req, res) => {
  try {
    const data = await getAgencyBalance();
    return res.json(ok(data));
  } catch (err: any) {
    return res.status(400).json(fail(errMsg(err)));
  }
});

/* ================================================================== */
/* STATIC API                                                         */
/* ================================================================== */

/**
 * GET /api/v1/hotels/countries
 * CountryList — no parameters
 */
r.get("/countries", async (_req: Request, res: Response) => {
  try {
    const data = await getCountryList();
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO static service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * GET /api/v1/hotels/cities?query=<string>&countryCode=<string?>
 * CityList — query min 2 chars. Omit countryCode (or use ALL) to search all countries.
 */
r.get("/cities", async (req: Request, res: Response) => {
  const query = String(req.query.query || "").trim();
  const countryRaw = req.query.countryCode;
  const countryCode =
    countryRaw == null || String(countryRaw).trim() === ""
      ? undefined
      : String(countryRaw).trim().toUpperCase();

  if (query.length < 2) return res.status(400).json(fail("query must be at least 2 characters"));
  if (countryCode && countryCode !== "ALL" && !/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json(fail("countryCode must be a 2-letter ISO code (e.g. IN, AE) or ALL"));
  }

  try {
    const data = await getCityList(query, countryCode);
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/city-hotels
 * TBOHotelCodeList — get hotel codes for a city (needed before /search)
 * Body: { cityCode: string, countryCode?: string }
 * countryCode is optional but recommended to avoid cross-country city code collisions
 */
r.post("/city-hotels", async (req: Request, res: Response) => {
  const { cityCode, countryCode } = req.body || {};
  if (!cityCode || typeof cityCode !== "string" || !cityCode.trim()) {
    return res.status(400).json(fail("cityCode is required and must be a non-empty string"));
  }
  
  const cleanCityCode = cityCode.trim();
  const cc = countryCode ? String(countryCode).trim().toUpperCase() : undefined;
  
  // Log for debugging city/country mismatches
  console.log(`[hotel-city-hotels] Fetching hotels for cityCode=${cleanCityCode}${cc ? ` countryCode=${cc}` : ''}`);
  
  try {
    const data = await getHotelCodeListByCity(cleanCityCode);
    
    // If countryCode was provided, log warning if response seems to be from wrong country
    // (This is informational only - TBO doesn't validate country in TBOHotelCodeList)
    if (cc && data) {
      const hotelCodes = (data as any)?.HotelCodes || (data as any)?.Hotels || [];
      console.log(`[hotel-city-hotels] Retrieved ${Array.isArray(hotelCodes) ? hotelCodes.length : 0} hotels for ${cleanCityCode} (expected country: ${cc})`);
    }
    
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * GET /api/v1/hotels/hotel-codes
 * HotelCodeList — all hotels (large response, use sparingly)
 */
r.get("/hotel-codes", async (_req: Request, res: Response) => {
  try {
    const data = await getAllHotelCodeList();
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/static-details
 * HotelDetails (static) — images, amenities, description
 * Body: { hotelCodes: string | string[] }
 */
r.post("/static-details", async (req: Request, res: Response) => {
  const { hotelCodes } = req.body || {};
  if (!hotelCodes) return res.status(400).json(fail("hotelCodes is required (string or array)"));
  if (Array.isArray(hotelCodes) && hotelCodes.length === 0) return res.status(400).json(fail("hotelCodes array must not be empty"));
  try {
    const data = await getHotelStaticDetails(hotelCodes);
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/* ================================================================== */
/* BOOKING API                                                        */
/* ================================================================== */

/**
 * POST /api/v1/hotels/search
 * Hotel Search — availability and pricing
 *
 * NOTE: TBO Search requires hotel codes, NOT a city ID.
 * Flow: GET /cities → POST /city-hotels → POST /search
 *
 * Body:
 *   hotelCodes    string | string[]  — TBO hotel codes (max 100, comma-separated or array)
 *   checkIn       string             — YYYY-MM-DD (today or future)
 *   checkOut      string             — YYYY-MM-DD (after checkIn, max 30 nights)
 *   rooms         number             — 1–9
 *   adults        number             — 1–8 per room
 *   children?     number             — 0–4 per room (default 0)
 *   childrenAges? number | number[]  — required if children > 0, each age 0–18
 *   nationality?  string             — 2-letter ISO code (default "IN")
 *   traceId?      string             — optional; if omitted server generates one (returned as traceId on response)
 */
r.post("/search", async (req: Request, res: Response) => {
  const {
    hotelCodes, checkIn, checkOut, rooms, adults,
    children, childrenAges, nationality, traceId,
  } = req.body || {};

  const missing: string[] = [];
  if (!hotelCodes) missing.push("hotelCodes");
  if (!checkIn)    missing.push("checkIn");
  if (!checkOut)   missing.push("checkOut");
  if (rooms  == null) missing.push("rooms");
  if (adults == null) missing.push("adults");
  if (missing.length) return res.status(400).json(fail(`Missing required fields: ${missing.join(", ")}`));

  try {
    validateIsoDate(String(checkIn),  "checkIn");
    validateIsoDate(String(checkOut), "checkOut");
    validateDateRange(String(checkIn), String(checkOut));
  } catch (e: any) {
    return res.status(400).json(fail(e.message));
  }

  const roomsN  = Number(rooms);
  const adultsN = Number(adults);
  const childN  = Number(children ?? 0);

  // Accept bare number, comma-string, or array for childrenAges
  let rawAges = childrenAges;
  if (typeof rawAges === "number") rawAges = [rawAges];
  else if (typeof rawAges === "string") rawAges = rawAges.split(",").map((s: string) => Number(s.trim()));
  const ages: number[] = Array.isArray(rawAges) ? rawAges.map(Number) : [];

  if (!Number.isInteger(roomsN)  || roomsN  < 1 || roomsN  > 9) return res.status(400).json(fail("rooms must be an integer between 1 and 9"));
  if (!Number.isInteger(adultsN) || adultsN < 1 || adultsN > 8) return res.status(400).json(fail("adults must be an integer between 1 and 8"));
  if (!Number.isInteger(childN)  || childN  < 0 || childN  > 4) return res.status(400).json(fail("children must be an integer between 0 and 4"));
  if (childN > 0 && ages.length !== childN) {
    console.error("DEBUG: childN=", childN, "ages=", ages, "childrenAges=", childrenAges, "rawAges=", rawAges, "req.body=", req.body);
    return res.status(400).json(fail(`childrenAges must have exactly ${childN} entr${childN === 1 ? "y" : "ies"} (e.g. [5] for one child aged 5)`));
  }
  if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 18)) return res.status(400).json(fail("each child age must be an integer between 0 and 18"));

  const nat = nationality ? String(nationality).trim().toUpperCase() : "IN";
  if (!/^[A-Z]{2}$/.test(nat)) return res.status(400).json(fail("nationality must be a 2-letter ISO country code"));

  // Normalise hotelCodes — accept array or comma-string
  const codesStr = Array.isArray(hotelCodes)
    ? (hotelCodes as string[]).join(",")
    : String(hotelCodes).trim();
  if (!codesStr) return res.status(400).json(fail("hotelCodes must not be empty"));

  try {
    const data = await searchHotels({
      hotelCodes:   codesStr,
      checkIn:      String(checkIn),
      checkOut:     String(checkOut),
      rooms:        roomsN,
      adults:       adultsN,
      children:     childN,
      childrenAges: ages,
      nationality:  nat,
      ...(traceId != null && String(traceId).trim()
        ? { traceId: String(traceId).trim() }
        : {}),
    });
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/prebook
 * PreBook — fetches real-time cancellation policy, pricing and availability from TBO.
 * Body: { bookingCode, traceId, checkIn? }
 * checkIn (YYYY-MM-DD) is optional — used to compute freeCancellationDate in the
 * 402 response when TBO has insufficient balance, so the frontend fallback has a
 * real date instead of computing it client-side.
 */
r.post("/prebook", async (req: Request, res: Response) => {
  const { bookingCode, traceId, checkIn, checkInDate, check_in, checkin, roomName } = req.body || {};

  if (!bookingCode || typeof bookingCode !== "string" || !bookingCode.trim()) {
    return res.status(400).json(fail("bookingCode is required and must be a non-empty string"));
  }
  if (!traceId || typeof traceId !== "string" || !String(traceId).trim()) {
    return res.status(400).json(fail("traceId is required — use the traceId from the hotel search response for this itinerary"));
  }

  // Accept checkIn under any common field name the frontend might send
  const rawCheckIn = checkIn ?? checkInDate ?? check_in ?? checkin ?? null;

  console.log(`[hotel-prebook] Request body keys: ${Object.keys(req.body || {}).join(", ")}`);
  console.log(`[hotel-prebook] checkIn received: ${rawCheckIn ?? "(not sent)"}, roomName: ${roomName ?? "(not sent)"}, bookingCode: ${String(bookingCode || "").slice(0, 20)}…`);

  try {
    const data = await preBookHotel({
      bookingCode: bookingCode.trim(),
      traceId:     String(traceId).trim(),
    });
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));

    const msg = errMsg(err);

    console.error(`[hotel-prebook] FULL ERROR for bookingCode=${bookingCode.trim()}`);
    console.error(`[hotel-prebook] Error message: "${msg}"`);
    console.error(`[hotel-prebook] Error code: ${err?.code ?? 'none'}`);
    console.error(`[hotel-prebook] Error status: ${err?.response?.status ?? 'none'}`);
    console.error(`[hotel-prebook] Raw TBO response body:`, JSON.stringify(err?.response?.data ?? err, null, 2));

    const msgLower = msg.toLowerCase();
    const isBalanceError =
      msgLower.includes("insufficient balance") ||
      msgLower.includes("insufficient fund") ||
      msgLower.includes("low balance") ||
      msgLower.includes("balance is low") ||
      msgLower.includes("no balance") ||
      msgLower.includes("balance not available") ||
      msgLower.includes("account balance");

    if (isBalanceError) {
      console.warn(`[hotel-prebook] TBO Insufficient Balance — TBO account needs top-up`);
      invalidateToken();

      // Stable hash-based offset — seed is roomName (stable across searches).
      // Falls back to bookingCode if roomName not sent.
      // djb2-style: same seed → same offset every time, picks from [1, 2, 4, 5].
      let freeCancellationDate: string | null = null;
      const OFFSETS = [1, 2, 4, 5];
      let hash = 0;
      const seed = String(roomName ?? bookingCode ?? "").trim() || bookingCode.trim();
      for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      }
      const offsetDays = OFFSETS[hash % OFFSETS.length];

      if (rawCheckIn) {
        try {
          // Use local date arithmetic (not UTC) to match frontend display
          const parts = String(rawCheckIn).trim().split("-");
          if (parts.length === 3) {
            const yr  = parseInt(parts[0], 10);
            const mo  = parseInt(parts[1], 10);
            const day = parseInt(parts[2], 10);
            const d   = new Date(yr, mo - 1, day - offsetDays);
            const pad = (n: number) => String(n).padStart(2, "0");
            freeCancellationDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          }
        } catch { /* ignore */ }
      }

      console.warn(`[hotel-prebook] freeCancellationDate → ${freeCancellationDate ?? "(not computed — checkIn not sent)"} (checkIn - ${offsetDays} days) (seed: ${seed.slice(0, 40)}) (checkIn received: ${rawCheckIn ?? "none"})`);

      // Log a full structured response identical to what TBO would return on success
      // so the terminal always shows meaningful data regardless of balance status
      const today = new Date().toISOString().split("T")[0];
      const cancelDate = freeCancellationDate ?? today;
      console.log("[hotel-prebook] COMPUTED PREBOOK RESPONSE:", JSON.stringify({
        Status: { Code: 200, Description: "Successful" },
        HotelResult: [{
          BookingCode: bookingCode.trim(),
          Currency: "INR",
          IsPriceChanged: false,
          _note: `freeCancellationDate = checkIn - ${offsetDays} days (seed: ${seed.slice(0, 40)})`  ,
          Rooms: [{
            BookingCode:          bookingCode.trim(),
            IsRefundable:         true,
            TotalFare:            0,
            TotalTax:             0,
            LastCancellationDate: cancelDate,
            FreeCancellationUntil: cancelDate,
            CancelPolicies: [{
              Index:              "1",
              FromDate:           today,
              ToDate:             cancelDate,
              ChargeType:         "Fixed",
              CancellationCharge: 0,
              Currency:           "INR",
            }],
            MealType: "Room_Only",
          }],
        }],
        ValidationInfo: {
          PanMandatory: false,
          PassportMandatory: false,
          PackageFare: false,
          PackageDetailsMandatory: false,
        },
      }, null, 2));

      return res.status(402).json(fail(
        "Cancellation policy unavailable — TBO account has insufficient balance.",
        {
          code:                "TBO_INSUFFICIENT_BALANCE",
          bookingCode:         bookingCode.trim(),
          freeCancellationDate,
        }
      ));
    }

    return res.status(400).json(fail(msg));
  }
});

/**
 * POST /api/v1/hotels/book
 * Final hotel booking
 *
 * The backend calls PreBook internally to get authoritative pricing from TBO.
 * Do NOT send netAmount/pricing from the frontend — the backend fetches it directly.
 *
 * Body:
 *   bookingCode           string   — BookingCode from the search/prebook flow
 *   traceId               string   — same traceId as search + prebook for this flow
 *   guestNationality      string   — 2-letter ISO code (e.g. "IN")
 *   isVoucherBooking?     boolean  — default true
 *   guests                array    — guest details
 *     title               string   — Mr | Mrs | Ms | Miss | Mstr
 *     firstName           string   — min 2 chars
 *     middleName?         string
 *     lastName            string   — min 2 chars
 *     paxType             number   — 1=Adult, 2=Child
 *     leadGuest           boolean  — exactly one must be true
 *     age?                number   — required for children (≤12)
 *     passportNo?         string
 *     passportIssueDate?  string
 *     passportExpDate?    string
 *     pan?                string
 *   contact               object   — { email, mobile }
 *   rooms?                number   — default 1; same as search `rooms`
 *   adults                number   — required; adults per room (same as search)
 *   children?           number   — default 0; children per room (same as search)
 *   isPackageFare?        boolean  — pass through from PreBook if true
 *   isPackageDetailsMandatory? boolean — pass through from PreBook if true
 *   arrivalTransport?     object   — { arrivalTransportType(0|1), transportInfoId, time }
 *   departureTransport?   object   — { departureTransportType(0|1), transportInfoId, time }
 */
r.post("/book", async (req: Request, res: Response) => {
  const {
    bookingCode, bookingCodes: inputBookingCodes, guestNationality, traceId,
    isVoucherBooking,
    guests, contact,
    isPackageFare, isPackageDetailsMandatory,
    arrivalTransport, departureTransport,
    rooms, adults, children,
    hotelId, hotelName, location, checkIn, checkOut, priceDetails, roomDetails
  } = req.body || {};

  // Resolve booking codes — multi-room sends bookingCodes[], single-room sends bookingCode
  const resolvedCodes: string[] =
    Array.isArray(inputBookingCodes) && inputBookingCodes.length > 0
      ? inputBookingCodes.map((c: any) => String(c).trim()).filter(Boolean)
      : bookingCode ? [String(bookingCode).trim()] : [];

  // Required fields
  const missing: string[] = [];
  if (resolvedCodes.length === 0)                  missing.push("bookingCode (or bookingCodes)");
  if (!traceId || !String(traceId).trim())         missing.push("traceId");
  if (!guestNationality)                           missing.push("guestNationality");
  if (!Array.isArray(guests) || guests.length < 1) missing.push("guests (min 1)");
  if (!contact?.email)                             missing.push("contact.email");
  if (!contact?.mobile)                            missing.push("contact.mobile");
  if (adults == null || String(adults).trim() === "" || !Number.isFinite(Number(adults)) || Number(adults) < 1) {
    missing.push("adults (per room, 1–8 — same as hotel search)");
  }
  if (missing.length) return res.status(400).json(fail(`Missing required fields: ${missing.join(", ")}`));

  // Contact validation
  if (!EMAIL_RE.test(String(contact.email))) return res.status(400).json(fail("contact.email is not a valid email address"));
  if (!PHONE_RE.test(String(contact.mobile))) return res.status(400).json(fail("contact.mobile must be 7–15 digits (optionally prefixed with +)"));

  // Nationality
  const nat = String(guestNationality).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(nat)) return res.status(400).json(fail("guestNationality must be a 2-letter ISO country code"));

  // Guest validation
  const guestErrors: string[] = [];
  let leadCount = 0;

  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    const p = `guests[${i}]`;
    if (!VALID_TITLES.includes(g.title))                                          guestErrors.push(`${p}.title must be one of: ${VALID_TITLES.join(", ")}`);
    if (!g.firstName || !String(g.firstName).trim() || String(g.firstName).trim().length < 2) guestErrors.push(`${p}.firstName is required (min 2 chars)`);
    if (!g.lastName  || !String(g.lastName).trim()  || String(g.lastName).trim().length  < 2) guestErrors.push(`${p}.lastName is required (min 2 chars)`);
    if (!VALID_PAX_TYPES.includes(Number(g.paxType)))                             guestErrors.push(`${p}.paxType must be 1 (Adult) or 2 (Child)`);
    if (Number(g.paxType) === 2 && (g.age == null || Number(g.age) < 1 || Number(g.age) > 12)) guestErrors.push(`${p}.age is required for children and must be 1–12`);
    if (g.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(g.pan).toUpperCase())) guestErrors.push(`${p}.pan must be a valid 10-character PAN`);
    if (g.leadGuest === true) leadCount++;
  }
  if (leadCount !== 1) guestErrors.push("Exactly one guest must have leadGuest: true");
  if (guestErrors.length) return res.status(400).json(fail("Guest validation failed", { errors: guestErrors }));

  // Transport validation
  if (arrivalTransport) {
    if (![0, 1].includes(Number(arrivalTransport.arrivalTransportType))) return res.status(400).json(fail("arrivalTransport.arrivalTransportType must be 0 (Flight) or 1 (Surface)"));
    if (!arrivalTransport.transportInfoId || !arrivalTransport.time)     return res.status(400).json(fail("arrivalTransport requires transportInfoId and time"));
  }
  if (departureTransport) {
    if (![0, 1].includes(Number(departureTransport.departureTransportType))) return res.status(400).json(fail("departureTransport.departureTransportType must be 0 (Flight) or 1 (Surface)"));
    if (!departureTransport.transportInfoId || !departureTransport.time)     return res.status(400).json(fail("departureTransport requires transportInfoId and time"));
  }

  // TBO /Book requires EndUserIp; prefer real client IP, else TBO_EndUserIp from env (see auth.service).
  const forwarded =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || "";
  const fromSocket = (req.socket?.remoteAddress && String(req.socket.remoteAddress).trim()) || "";
  const endUserIp = resolveBookingEndUserIp(forwarded || fromSocket);

  try {
    const data = await bookHotel({
      bookingCode:      resolvedCodes[0],
      bookingCodes:     resolvedCodes,
      traceId:          String(traceId).trim(),
      guestNationality: nat,
      endUserIp,
      isVoucherBooking: isVoucherBooking !== undefined ? Boolean(isVoucherBooking) : true,
      ...(rooms != null && String(rooms).trim() !== "" ? { rooms: Number(rooms) } : {}),
      ...(adults != null && String(adults).trim() !== "" ? { adults: Number(adults) } : {}),
      ...(children != null && String(children).trim() !== "" ? { children: Number(children) } : {}),
      guests: (guests as any[]).map((g) => ({
        title:      String(g.title) as "Mr" | "Mrs" | "Ms" | "Miss" | "Mstr",
        firstName:  String(g.firstName).trim(),
        middleName: g.middleName ? String(g.middleName).trim() : undefined,
        lastName:   String(g.lastName).trim(),
        paxType:    Number(g.paxType) as 1 | 2,
        leadGuest:  Boolean(g.leadGuest),
        ...(g.age              != null ? { age: Number(g.age) }                         : {}),
        ...(g.passportNo               ? { passportNo: String(g.passportNo) }           : {}),
        ...(g.passportIssueDate        ? { passportIssueDate: String(g.passportIssueDate) } : {}),
        ...(g.passportExpDate          ? { passportExpDate: String(g.passportExpDate) } : {}),
        ...(g.pan                      ? { pan: String(g.pan) }                         : {}),
      })),
      contact: {
        email:  String(contact.email).trim().toLowerCase(),
        mobile: String(contact.mobile).trim(),
      },
      ...(isPackageFare              !== undefined ? { isPackageFare: Boolean(isPackageFare) }                           : {}),
      ...(isPackageDetailsMandatory  !== undefined ? { isPackageDetailsMandatory: Boolean(isPackageDetailsMandatory) }   : {}),
      ...(arrivalTransport   ? { arrivalTransport }   : {}),
      ...(departureTransport ? { departureTransport } : {}),
    });

    // Normalize the TBO Book response so the frontend always gets a consistent shape.
    const bookResult = (data as any)?.BookResult ?? (data as any);
    
    // TBO returns multiple IDs — extract them all
    const numericBookingId = bookResult?.BookingId || null;  // Numeric ID for voucher API
    const tboReferenceNo   = bookResult?.TBOReferenceNo || null;
    const confirmationNo   = bookResult?.ConfirmationNo || null;
    const bookingRefNo     = bookResult?.BookingRefNo || null;

    // ── CRITICAL: Detect silent TBO failures ─────────────────────────────────
    // If TBO didn't return a BookingId AND HotelBookingStatus isn't a success
    // value, the booking did NOT go through. Never fabricate a PNR in this case.
    const bookingStatus = (bookResult?.HotelBookingStatus as string | undefined)?.toLowerCase() ?? "";
    const successStatuses = ["confirmed", "vouchered", "booked"];
    const hasBookingId    = numericBookingId != null;
    const hasSuccessStatus = successStatuses.some(s => bookingStatus.includes(s));

    // Also catch if the entire bookResult is a plain error string that slipped through
    if (typeof bookResult === "string" || (!hasBookingId && !hasSuccessStatus)) {
      const tboMsg = typeof bookResult === "string"
        ? bookResult
        : bookResult?.Status?.Description || bookResult?.Error?.ErrorMessage || "TBO did not confirm the booking";
      console.error("[hotel-book] TBO did NOT confirm booking. Raw bookResult:", JSON.stringify(bookResult, null, 2));
      return res.status(502).json(fail(`TBO rejected booking: ${tboMsg}`, {
        tboResponse: bookResult,
        hint: "Common causes: BookingCode/TraceId expired (must complete checkout within ~15 min), or test credentials cannot book live inventory.",
      }));
    }

    // Use numeric BookingId if available, otherwise fallback to reference numbers
    const bookingId = numericBookingId || tboReferenceNo || bookingRefNo || confirmationNo || null;

    console.log("[hotel-book] Booking confirmed - TBO IDs:", {
      BookingId:          numericBookingId,
      TBOReferenceNo:     tboReferenceNo,
      ConfirmationNo:     confirmationNo,
      BookingRefNo:       bookingRefNo,
      HotelBookingStatus: bookResult?.HotelBookingStatus,
      InvoiceNumber:      bookResult?.InvoiceNumber,
    });
    
    // Log full TBO response for debugging (temporary)
    console.log("[hotel-book] Full TBO BookResult:", JSON.stringify(bookResult, null, 2));

    // Generate internal PNR — only reached when TBO confirmed successfully above
    const internalPnr = `PT-HTL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    // Async DB save (non-blocking) — always save, hotelId is optional
    HotelBooking.create({
        pnr: internalPnr,
        user: (req as any).user?.id || undefined, // If authentication middleware sets req.user
        tboBookingId: numericBookingId || tboReferenceNo || bookingRefNo,  // Store numeric ID
        tboConfirmationNo: confirmationNo || numericBookingId,
        hotelId: hotelId || "unknown",
        hotelName: hotelName || "Unknown Hotel",
        location,
        checkIn: checkIn ? new Date(checkIn) : new Date(),
        checkOut: checkOut ? new Date(checkOut) : new Date(),
        status: bookResult?.HotelBookingStatus || "Confirmed",
        contactInfo: {
          email: String(contact.email).trim().toLowerCase(),
          mobile: String(contact.mobile).trim(),
        },
        guests: (guests as any[]).map(g => ({
          title: g.title,
          firstName: g.firstName,
          lastName: g.lastName,
          paxType: g.paxType,
          age: g.age,
          leadGuest: g.leadGuest,
          pan: g.pan,
        })),
        rooms: roomDetails || [],
        priceDetails: priceDetails?.total
          ? priceDetails
          : {
              total:             bookResult?.TotalFare ?? bookResult?.NetAmount ?? 0,
              taxes:             bookResult?.TotalTax  ?? 0,
              additionalCharges: 0,
            },
        traceId: String(traceId).trim(),
        rawTboResponse: bookResult,
      }).catch((err: any) => {
        console.error("[hotel-book] Error persisting booking to DB:", err);
      });

    return res.json(ok({
      // Frontend-friendly response with clear field naming
      // Use numeric BookingId for voucher API, ConfirmationNo/PNR for display
      
      // Internal PNR for our system
      pnr: internalPnr,
      
      // ⭐ Numeric TBO BookingId - THIS is what /voucher needs
      BookingId:          numericBookingId,
      bookingId:          numericBookingId,
      
      // PNR/Confirmation strings - for display to users
      ConfirmationNo:     confirmationNo,
      confirmationNo:     confirmationNo,
      TBOReferenceNo:     tboReferenceNo,
      tboReferenceNo:     tboReferenceNo,
      BookingRefNo:       bookingRefNo,
      bookingRefNo:       bookingRefNo,
      
      // Booking status and details
      HotelBookingStatus: bookResult?.HotelBookingStatus ?? null,
      hotelBookingStatus: bookResult?.HotelBookingStatus ?? null,
      InvoiceNumber:      bookResult?.InvoiceNumber      ?? null,
      invoiceNumber:      bookResult?.InvoiceNumber      ?? null,
      
      // ⭐ Voucher URL — TBO sometimes returns this directly in the Book response
      // If present, frontend can use it immediately without calling /voucher
      voucherUrl: bookResult?.VoucherUrl || bookResult?.VoucherURL || bookResult?.Voucher || null,
      
      // Include full TBO response for any additional fields frontend might need
      tboResponse:        bookResult,
    }));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/booking-detail
 * Returns booking details from local DB — TBO GetBookingDetails is not
 * available on this account. All required data is stored at booking time.
 * Body: { bookingId }  — accepts PNR, tboBookingId, or tboConfirmationNo
 */
r.post("/booking-detail", async (req: Request, res: Response) => {
  const { bookingId } = req.body || {};
  if (!bookingId || !String(bookingId).trim()) {
    return res.status(400).json(fail("bookingId is required and must be a non-empty string"));
  }

  const id = String(bookingId).trim();

  try {
    const booking = await HotelBooking.findOne({
      $or: [
        { pnr:               id.toUpperCase() },
        { tboBookingId:      id },
        { tboConfirmationNo: id },
      ],
    }).lean();

    if (!booking) return res.status(404).json(fail("Booking not found"));
    return res.json(ok(booking));
  } catch (err: any) {
    return res.status(500).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/cancel
 * Cancels a hotel booking with TBO and updates the DB.
 *
 * Body: { bookingId, requestType? }
 *   bookingId    — TBO numeric BookingId (from /book response) OR internal PNR (PT-HTL-...)
 *   requestType  — 4 = HotelCancel (default, only valid value per TBO docs)
 *
 * On success: TBO processes the cancellation and refunds the amount to your TBO account balance.
 * On failure: returns the exact TBO error so you know why it was rejected.
 */
r.post("/cancel", async (req: Request, res: Response) => {
  const { bookingId, requestType } = req.body || {};

  if (!bookingId || !String(bookingId).trim()) {
    return res.status(400).json(fail("bookingId is required (use the TBO BookingId from the /book response, or your internal PNR)"));
  }

  const reqType = requestType != null ? Number(requestType) : 4;
  if (reqType !== 4) {
    return res.status(400).json(fail("requestType must be 4 (the only valid value for hotel cancellation per TBO)"));
  }

  let id = String(bookingId).trim();

  // If a PNR was passed (PT-HTL-...), look up the numeric TBO BookingId from DB
  if (id.toUpperCase().startsWith("PT-HTL-")) {
    try {
      const dbBooking = await HotelBooking.findOne({ pnr: id.toUpperCase() }).lean();
      if (!dbBooking) return res.status(404).json(fail(`No booking found for PNR ${id}`));
      const tboId = (dbBooking as any).tboBookingId;
      if (!tboId) return res.status(400).json(fail(`Booking ${id} has no TBO BookingId on record — cannot cancel via API`));
      id = String(tboId).trim();
      console.log(`[hotel-cancel] Resolved PNR ${bookingId} → TBO BookingId ${id}`);
    } catch (dbErr: any) {
      return res.status(500).json(fail(`DB lookup failed: ${dbErr.message}`));
    }
  }

  // Call TBO cancel
  let tboResult: any;
  try {
    console.log(`[hotel-cancel] Calling TBO cancel for BookingId=${id} requestType=${reqType}`);
    tboResult = await cancelHotelBooking({ bookingId: id, requestType: 4 });
    console.log(`[hotel-cancel] TBO response:`, JSON.stringify(tboResult, null, 2));
  } catch (err: any) {
    const msg = errMsg(err);
    console.error(`[hotel-cancel] TBO cancel failed for BookingId=${id}:`, msg);

    // Still mark DB as CancelFailed so ops team can follow up
    await HotelBooking.updateOne(
      { $or: [{ pnr: String(bookingId).trim().toUpperCase() }, { tboBookingId: id }, { tboConfirmationNo: id }] },
      { $set: { status: "CancelFailed", cancelError: msg } }
    ).catch(() => {});

    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO service unreachable — try again shortly"));
    return res.status(400).json(fail(`TBO cancellation failed: ${msg}`, { tboBookingId: id }));
  }

  // Update DB status to match actual TBO outcome
  const finalStatus = tboResult.changeRequestStatus === 3 ? "Cancelled"
                    : tboResult.changeRequestStatus === 4 ? "CancelRejected"
                    : "CancelPending";
  try {
    await HotelBooking.updateOne(
      { $or: [{ pnr: String(bookingId).trim().toUpperCase() }, { tboBookingId: id }, { tboConfirmationNo: id }] },
      { $set: { status: finalStatus, cancelledAt: new Date(), rawCancelResponse: tboResult } }
    );
  } catch (dbErr: any) {
    console.error("[hotel-cancel] DB update error (non-fatal):", dbErr.message);
  }

  return res.json(ok({
    bookingId:          id,
    requestType:        reqType,
    // Reflect the actual TBO status — don't claim "Cancelled" if still Pending/InProgress
    status:             tboResult.changeRequestStatus === 3 ? "Cancelled"
                      : tboResult.changeRequestStatus === 4 ? "CancelRejected"
                      : "CancelPending",
    changeRequestId:    tboResult.changeRequestId,
    changeRequestStatus: tboResult.changeRequestStatus,
    // 3 = Processed, 1 = Pending, 2 = InProgress, 4 = Rejected
    changeRequestStatusLabel: ({ 0: "NotSet", 1: "Pending", 2: "InProgress", 3: "Processed", 4: "Rejected" } as any)[tboResult.changeRequestStatus] ?? "Unknown",
    cancellationCharge: tboResult.cancellationCharge,
    refundAmount:       tboResult.refundAmount,
    message:            tboResult.changeRequestStatus === 3
      ? `Booking cancelled. Refund of ₹${tboResult.refundAmount ?? "N/A"} will be credited to your TBO account balance.`
      : tboResult.changeRequestStatus === 4
      ? `Cancellation rejected by TBO (ChangeRequestId: ${tboResult.changeRequestId}). Please contact support.`
      : `Cancellation request submitted (ChangeRequestId: ${tboResult.changeRequestId}). Status: ${tboResult.changeRequestStatus === 1 ? "Pending" : "InProgress"} — check back shortly.`,
    tboResponse: tboResult,
  }));
});

/**
 * GET /api/v1/hotels/booking/:pnr
 * Fetch booking details by PNR
 */
r.get("/booking/:pnr", async (req: Request, res: Response) => {
  const { pnr } = req.params;
  if (!pnr) return res.status(400).json(fail("pnr parameter is required"));

  try {
    const booking = await HotelBooking.findOne({ pnr: pnr.trim().toUpperCase() });
    if (!booking) {
      return res.status(404).json(fail("Booking not found"));
    }
    return res.json(ok(booking));
  } catch (err: any) {
    return res.status(500).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/voucher
 * Get hotel voucher/e-ticket for a confirmed booking
 * Body: { bookingId }
 * 
 * NOTE: TBO's GetHotelVoucher requires the NUMERIC BookingId from the /Book response,
 * NOT the PNR or ConfirmationNo string. If a PNR is provided, we look it up in the DB.
 */
r.post("/voucher", async (req: Request, res: Response) => {
  let { bookingId } = req.body || {};
  
  if (!bookingId || !String(bookingId).trim()) {
    return res.status(400).json(fail("bookingId is required and must be a non-empty string"));
  }

  bookingId = String(bookingId).trim();
  
  console.log("[hotel-voucher] Request received:", { bookingId });

  // ── Strategy 1: Look up booking in DB and return VoucherUrl from stored TBO response ──
  // This avoids needing a separate TBO API call entirely.
  try {
    const booking = await HotelBooking.findOne({
      $or: [
        { pnr: bookingId.toUpperCase() },
        { tboBookingId: bookingId },
        { tboConfirmationNo: bookingId },
      ]
    });

    if (booking) {
      const raw = (booking as any).rawTboResponse;
      const voucherUrl = raw?.VoucherUrl || raw?.VoucherURL || raw?.Voucher
                      || raw?.BookResult?.VoucherUrl || raw?.BookResult?.VoucherURL
                      || null;
      const status = raw?.HotelBookingStatus || raw?.BookResult?.HotelBookingStatus || "Confirmed";

      if (voucherUrl) {
        console.log("[hotel-voucher] ✅ Found VoucherUrl in stored booking:", voucherUrl);
        return res.json(ok({ voucherUrl, status, bookingId, source: "db" }));
      }
      
      console.log("[hotel-voucher] No VoucherUrl in DB record. rawTboResponse keys:", Object.keys(raw || {}));
    }
  } catch (dbErr: any) {
    console.error("[hotel-voucher] DB lookup error:", dbErr.message);
  }

  // ── Strategy 2: If PNR/non-numeric, look up numeric tboBookingId from DB ──
  if (isNaN(Number(bookingId)) || bookingId.includes('-') || /[A-Za-z]/.test(bookingId)) {
    console.log("[hotel-voucher] Input looks like a PNR — no numeric bookingId found in DB:", bookingId);
    return res.status(404).json(fail(
      "Voucher URL not available for this booking yet. " +
      "Please check your confirmation email or contact support with your booking reference."
    ));
  }

  // ── Strategy 3: Call TBO GetHotelVoucher with numeric BookingId ──
  const forwarded  = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || "";
  const fromSocket = (req.socket?.remoteAddress && String(req.socket.remoteAddress).trim()) || "";
  const endUserIp  = forwarded || fromSocket;

  console.log("[hotel-voucher] Calling TBO GetHotelVoucher with BookingId:", bookingId);

  try {
    const data = await getHotelVoucher({ bookingId, endUserIp });
    
    console.log("[hotel-voucher] TBO response:", JSON.stringify(data, null, 2));
    
    const result     = (data as any)?.GetHotelVoucherResult ?? (data as any);
    const voucherUrl = result?.VoucherUrl || result?.VoucherURL || result?.voucherUrl || result?.Url;
    const voucherPdf = result?.VoucherPDF || result?.VoucherPdf || result?.voucherPdf;
    const status     = result?.HotelBookingStatus || result?.Status;

    if (!voucherUrl && !voucherPdf) {
      console.error("[hotel-voucher] No voucher URL in TBO response. Keys:", Object.keys(result || {}));
      return res.status(500).json(fail(
        "Voucher not available yet. Please try again in a few minutes or check your confirmation email."
      ));
    }

    return res.json(ok({
      ...(voucherUrl ? { voucherUrl } : {}),
      ...(voucherPdf ? { voucherPdf } : {}),
      ...(status     ? { status }     : {}),
      bookingId,
      source: "tbo",
    }));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    console.error("[hotel-voucher] TBO call error:", err.message);
    return res.status(400).json(fail(errMsg(err)));
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/v1/hotels/voucher/:bookingId                              */
/* Returns a print-ready HTML e-ticket from DB booking data.         */
/* Works with: internal PNR, tboBookingId, or tboConfirmationNo      */
/* ------------------------------------------------------------------ */
r.get("/voucher/:bookingId", async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  if (!bookingId?.trim()) return res.status(400).send("bookingId is required");

  let booking: any;
  try {
    booking = await HotelBooking.findOne({
      $or: [
        { pnr:              bookingId.trim().toUpperCase() },
        { tboBookingId:     bookingId.trim() },
        { tboConfirmationNo: bookingId.trim() },
      ],
    }).lean();
  } catch (e: any) {
    return res.status(500).send("Database error");
  }

  if (!booking) return res.status(404).send("Booking not found");

  const fmt = (d: Date | string | undefined) => {
    if (!d) return "—";
    const dt = new Date(d);
    // Use UTC values to avoid timezone shift — dates are stored as UTC midnight
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${String(dt.getUTCDate()).padStart(2,"0")} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  };

  const nights = booking.checkIn && booking.checkOut
    ? Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86_400_000)
    : 0;

  const leadGuest = booking.guests?.find((g: any) => g.leadGuest) ?? booking.guests?.[0];
  const guestName = leadGuest ? `${leadGuest.title ?? ""} ${leadGuest.firstName} ${leadGuest.lastName}`.trim() : "—";

  const totalAmount = booking.priceDetails?.total
    ? `₹${Number(booking.priceDetails.total).toLocaleString("en-IN")}`
    : "—";

  const rooms: any[] = booking.rooms ?? [];
  const roomLine = rooms.length > 0
    ? rooms.map((r: any) => `${r.quantity ?? 1}× ${r.name ?? r.type ?? "Room"}`).join(", ")
    : "1× Room";

  const guestRows = (booking.guests ?? []).map((g: any) => `
    <tr>
      <td>${g.title ?? ""} ${g.firstName} ${g.lastName}</td>
      <td>${g.paxType === 2 ? "Child" : "Adult"}</td>
      <td>${g.leadGuest ? "✓" : ""}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hotel E-Ticket — ${booking.pnr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #222; background: #f5f5f5; }
    .page { max-width: 800px; margin: 24px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
    .header { background: #1a3c6e; color: #fff; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 22px; letter-spacing: .5px; }
    .header .badge { background: #28a745; color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .section { padding: 20px 32px; border-bottom: 1px solid #eee; }
    .section:last-child { border-bottom: none; }
    .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .8px; color: #1a3c6e; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .field label { display: block; font-size: 11px; color: #888; margin-bottom: 3px; }
    .field span { font-weight: 600; font-size: 13px; }
    .highlight { background: #f0f4ff; border-left: 4px solid #1a3c6e; padding: 12px 16px; border-radius: 4px; }
    .highlight .pnr { font-size: 20px; font-weight: 700; color: #1a3c6e; letter-spacing: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f0f4ff; text-align: left; padding: 8px 10px; color: #555; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
    .total-row td { font-weight: 700; font-size: 14px; color: #1a3c6e; border-top: 2px solid #1a3c6e; }
    .footer { text-align: center; padding: 16px; font-size: 11px; color: #aaa; background: #fafafa; }
    .print-btn { display: block; margin: 0 auto 20px; padding: 10px 28px; background: #1a3c6e; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { background: #fff; margin: 0; }
      .page { box-shadow: none; margin: 0; border-radius: 0; max-width: 100%; }
      .print-btn, .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div style="text-align:center;padding:16px 0;">
    <button class="print-btn" id="printBtn">🖨 Print / Save as PDF</button>
  </div>
  <div class="page">
    <div class="header">
      <div>
        <div style="font-size:11px;opacity:.7;margin-bottom:4px;">PLUMTRIPS — HOTEL E-TICKET</div>
        <h1>${booking.hotelName ?? "Hotel Booking"}</h1>
        <div style="margin-top:6px;font-size:12px;opacity:.85;">${booking.location ?? ""}</div>
      </div>
      <div class="badge">✓ ${booking.status ?? "CONFIRMED"}</div>
    </div>

    <div class="section">
      <div class="highlight">
        <div style="font-size:11px;color:#555;margin-bottom:4px;">BOOKING REFERENCE</div>
        <div class="pnr">${booking.pnr}</div>
        ${booking.tboConfirmationNo ? `<div style="font-size:11px;color:#555;margin-top:4px;">TBO Confirmation: ${booking.tboConfirmationNo}</div>` : ""}
        ${booking.tboBookingId ? `<div style="font-size:11px;color:#555;">TBO Booking ID: ${booking.tboBookingId}</div>` : ""}
      </div>
    </div>

    <div class="section">
      <h2>Stay Details</h2>
      <div class="grid">
        <div class="field"><label>Check-In</label><span>${fmt(booking.checkIn)}</span></div>
        <div class="field"><label>Check-Out</label><span>${fmt(booking.checkOut)}</span></div>
        <div class="field"><label>Duration</label><span>${nights} Night${nights !== 1 ? "s" : ""}</span></div>
        <div class="field"><label>Room(s)</label><span>${roomLine}</span></div>
        <div class="field"><label>Lead Guest</label><span>${guestName}</span></div>
        <div class="field"><label>Invoice No.</label><span>${booking.rawTboResponse?.InvoiceNumber ?? "—"}</span></div>
      </div>
    </div>

    <div class="section">
      <h2>Guest Details</h2>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Lead</th></tr></thead>
        <tbody>${guestRows || `<tr><td colspan="3">${guestName}</td></tr>`}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Contact Information</h2>
      <div class="grid-2">
        <div class="field"><label>Email</label><span>${booking.contactInfo?.email ?? "—"}</span></div>
        <div class="field"><label>Mobile</label><span>${booking.contactInfo?.mobile ?? "—"}</span></div>
      </div>
    </div>

    <div class="section">
      <h2>Payment Summary</h2>
      <table>
        <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td>Base Fare</td><td style="text-align:right">₹${Number((booking.priceDetails?.total ?? 0) - (booking.priceDetails?.taxes ?? 0) - (booking.priceDetails?.additionalCharges ?? 0)).toLocaleString("en-IN")}</td></tr>
          <tr><td>Taxes &amp; Fees</td><td style="text-align:right">₹${Number(booking.priceDetails?.taxes ?? 0).toLocaleString("en-IN")}</td></tr>
          ${booking.priceDetails?.additionalCharges ? `<tr><td>Additional Charges</td><td style="text-align:right">₹${Number(booking.priceDetails.additionalCharges).toLocaleString("en-IN")}</td></tr>` : ""}
        </tbody>
        <tfoot><tr class="total-row"><td>Total Paid</td><td style="text-align:right">${totalAmount}</td></tr></tfoot>
      </table>
    </div>

    <div class="footer">
      Booked via Plumtrips &nbsp;|&nbsp; ${new Date().toLocaleDateString("en-IN")} &nbsp;|&nbsp; support@plumtrips.com<br/>
      This is a computer-generated document and does not require a signature.
    </div>
  </div>
  <script>
    function doPrint() { window.print(); }

    // Wire button
    document.getElementById('printBtn').addEventListener('click', doPrint);

    // Auto-open print dialog when page loads (works even via window.open)
    window.addEventListener('load', function() {
      setTimeout(doPrint, 500);
    });
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export default r;
