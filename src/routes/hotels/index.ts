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

r.post("/tbo/_invalidate-token", (_req, res) => {
  invalidateToken();
  res.json(ok({ message: "Token cache cleared" }));
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
 * Body: { cityCode: string }
 */
r.post("/city-hotels", async (req: Request, res: Response) => {
  const { cityCode } = req.body || {};
  if (!cityCode || typeof cityCode !== "string" || !cityCode.trim()) {
    return res.status(400).json(fail("cityCode is required and must be a non-empty string"));
  }
  try {
    const data = await getHotelCodeListByCity(cityCode.trim());
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
  if (childN > 0 && ages.length !== childN) return res.status(400).json(fail(`childrenAges must have exactly ${childN} entr${childN === 1 ? "y" : "ies"} (e.g. [5] for one child aged 5)`));
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
 * PreBook — verify latest price & availability before booking
 * Body: { bookingCode, traceId }  — traceId must match POST /search response.traceId
 */
r.post("/prebook", async (req: Request, res: Response) => {
  const { bookingCode, traceId } = req.body || {};

  if (!bookingCode || typeof bookingCode !== "string" || !bookingCode.trim()) {
    return res.status(400).json(fail("bookingCode is required and must be a non-empty string"));
  }
  if (!traceId || typeof traceId !== "string" || !String(traceId).trim()) {
    return res.status(400).json(fail("traceId is required — use the traceId from the hotel search response for this itinerary"));
  }

  try {
    const data = await preBookHotel({
      bookingCode: bookingCode.trim(),
      traceId:     String(traceId).trim(),
    });
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
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
    bookingCode, guestNationality, traceId,
    isVoucherBooking,
    guests, contact,
    isPackageFare, isPackageDetailsMandatory,
    arrivalTransport, departureTransport,
    rooms, adults, children,
  } = req.body || {};

  // Required fields
  const missing: string[] = [];
  if (!bookingCode)                                missing.push("bookingCode");
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
      bookingCode:      String(bookingCode).trim(),
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
    // TBO returns the booking reference in BookResult.TBOReferenceNo (and also
    // ConfirmationNo / BookingRefNo). Surface all of them as top-level fields.
    const bookResult = (data as any)?.BookResult ?? (data as any);
    const bookingId  =
      bookResult?.TBOReferenceNo  ||
      bookResult?.BookingRefNo    ||
      bookResult?.ConfirmationNo  ||
      null;

    console.log("[hotel-book] Booking confirmed:", {
      bookingId,
      hotelBookingStatus: bookResult?.HotelBookingStatus,
      invoiceNumber:      bookResult?.InvoiceNumber,
      confirmationNo:     bookResult?.ConfirmationNo,
      tboReferenceNo:     bookResult?.TBOReferenceNo,
    });

    return res.json(ok({
      ...((data as any) ?? {}),
      // Convenience fields for the frontend
      bookingId,
      hotelBookingStatus: bookResult?.HotelBookingStatus ?? null,
      invoiceNumber:      bookResult?.InvoiceNumber      ?? null,
      confirmationNo:     bookResult?.ConfirmationNo     ?? null,
      tboReferenceNo:     bookResult?.TBOReferenceNo     ?? null,
    }));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/booking-detail
 * GetBookingDetails — booking confirmation / status
 * Body: { bookingId }
 */
r.post("/booking-detail", async (req: Request, res: Response) => {
  const { bookingId } = req.body || {};
  if (!bookingId || !String(bookingId).trim()) {
    return res.status(400).json(fail("bookingId is required and must be a non-empty string"));
  }
  try {
    const data = await getHotelBookingDetail({ bookingId: String(bookingId).trim() });
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

/**
 * POST /api/v1/hotels/cancel
 * CancelBooking
 * Body: { bookingId, requestType }  — requestType: 1=Cancellation, 4=Amendment
 */
r.post("/cancel", async (req: Request, res: Response) => {
  const { bookingId, requestType } = req.body || {};

  const missing: string[] = [];
  if (!bookingId)          missing.push("bookingId");
  if (requestType == null) missing.push("requestType");
  if (missing.length) return res.status(400).json(fail(`Missing required fields: ${missing.join(", ")}`));

  const reqType = Number(requestType);
  if (reqType !== 1 && reqType !== 4) return res.status(400).json(fail("requestType must be 1 (Cancellation) or 4 (Amendment)"));

  try {
    const data = await cancelHotelBooking({
      bookingId:   String(bookingId).trim(),
      requestType: reqType as 1 | 4,
    });
    return res.json(ok(data));
  } catch (err: any) {
    if (err?.code === "TBO_UNREACHABLE") return res.status(503).json(fail("TBO hotel service unreachable"));
    return res.status(400).json(fail(errMsg(err)));
  }
});

export default r;
