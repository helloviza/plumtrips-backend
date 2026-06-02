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
import { httpHotel, httpHotelStatic, httpHotelBook } from "../../lib/http.js";
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
  body: Record<string, any>
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
        `TBO hotel HTTP 404 on ${path}. Check the base URL for this endpoint — Book, GetBookingDetails, and Cancel use TBO_HOTEL_BOOK_BASE_URL (HotelBE/hotelservice.svc/rest), not the affiliate HotelAPI.`
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

  const errFromResponse  = responseData?.Response?.Error;
  const errFromBookResult = responseData?.BookResult?.Error;
  const tboErr = errFromBookResult || errFromResponse;

  if (tboErr && tboErr.ErrorCode && tboErr.ErrorCode !== 0) {
    const msg = tboErr.ErrorMessage || "TBO error";
    const logTag = client === httpHotelBook ? "[hotel-book]" : "[hotel]";
    console.error(`${logTag} ${path} TBO error`, {
      code: tboErr.ErrorCode,
      msg,
      envelope: errFromBookResult ? "BookResult" : "Response",
    });
    throw Object.assign(new Error(msg), { tboCode: tboErr.ErrorCode });
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
    CountryCode: c.CountryCode || cc,
  }));
  cityListByCountryCache.set(cc, { at: now, cities });
  return cities;
}

function filterCitiesByQuery(cities: TboCityRow[], query: string): TboCityRow[] {
  const q = query.split(',')[0].trim().toLowerCase();
  if (!q) return [];
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

  if (cc && cc !== "ALL") {
    try {
      const cities = await fetchCitiesForCountry(cc);
      const filtered = filterCitiesByQuery(cities, query);
      if (filtered.length) {
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
    const fallback = fallbackCitySearch(query).filter((c) => c.CountryCode === cc);
    return {
      Status: { Code: 1, Description: "Success" },
      CityList: fallback,
      source: fallback.length ? "fallback" : "tbo",
    };
  }

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

  return {
    Status: { Code: 1, Description: "Success" },
    CityList: fallbackCitySearch(query),
    source: "fallback",
  };
}

/** POST /TBOHotelCodeList — { CityCode } */
export async function getHotelCodeListByCity(cityCode: string) {
  let finalCode = cityCode;
  if (finalCode.includes(":")) finalCode = finalCode.split(":")[1];
  return tboStaticPost("/TBOHotelCodeList", { CityCode: finalCode });
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
  nationality?:  string;   // 2-letter ISO, default "IN"
  /** Optional; if omitted a new UUID is generated and echoed as `traceId` on the response */
  traceId?:      string;
};

export async function searchHotels(input: HotelSearchInput) {
  const {
    hotelCodes, checkIn, checkOut, rooms, adults,
    children = 0, childrenAges = [],
    nationality = "IN",
  } = input;

  validateDateRange(checkIn, checkOut);

  if (rooms < 1 || rooms > 9)     throw new Error("rooms must be between 1 and 9");
  if (adults < 1 || adults > 8)   throw new Error("adults must be between 1 and 8 per room");
  if (children < 0 || children > 4) throw new Error("children must be between 0 and 4 per room");
  if (children > 0 && childrenAges.length !== children) {
    throw new Error(`childrenAges must have exactly ${children} entr${children === 1 ? "y" : "ies"}`);
  }
  if (childrenAges.some((age) => age < 0 || age > 18)) {
    throw new Error("each child age must be between 0 and 18");
  }

  const PaxRooms = Array.from({ length: rooms }, () => ({
    Adults:       adults,
    Children:     children,
    ChildrenAges: childrenAges.length > 0 ? childrenAges : [],
  }));

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

  // Process chunks with a smaller concurrency limit and retries to prevent TBO rate-limiting/dropping chunks
  const CONCURRENCY = 5;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (chunkCodes) => {
        const chunkTraceId = randomUUID();
        
        let raw: any = null;
        let lastErr: any = null;
        // Retry logic: up to 3 attempts per chunk
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            raw = await tboPost("/Search", {
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
            });
            break; // Success, break out of retry loop
          } catch (err) {
            lastErr = err;
            if (attempt === 3) throw err;
            // Wait before retrying (exponential backoff)
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
          // Inject the specific TraceId for this chunk into each hotel
          results.forEach(h => {
            h._traceId = outTrace;
          });
          allHotelResults.push(...results);
        }
      })
    );
  }

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

  const paymentMode = String(process.env.TBO_HOTEL_PREBOOK_PAYMENT_MODE ?? "Limit").trim() || "Limit";

  return tboPost("/PreBook", {
    BookingCode: input.bookingCode,
    TokenId:     tokenId,
    TraceId:     traceId,
    PaymentMode: paymentMode,
  });
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
};

export async function bookHotel(input: BookInput) {
  const {
    bookingCode, guestNationality, traceId: flowTraceId,
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

  // ── Occupancy → HotelRoomsDetails (TBO: one array entry per room from Search PaxRooms) ──
  const roomsN =
    input.rooms != null && String(input.rooms).trim() !== ""
      ? Number(input.rooms)
      : 1;
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

  const paxPerRoom   = adultsPerRoom + childrenPerRoom;
  const expectedTotal = roomsN * paxPerRoom;

  if (paxPerRoom < 1) throw new Error("Each room needs at least one guest (adults + children per room)");

  if (guests.length !== expectedTotal) {
    throw new Error(
      `This booking needs ${expectedTotal} guest(s) in the guests array (rooms=${roomsN} × (${adultsPerRoom} adults + ${childrenPerRoom} children) per room). You sent ${guests.length}. Use the same occupancy as hotel search — one guest object per traveller.`
    );
  }
  if (inferredAdults !== roomsN * adultsPerRoom || inferredChildren !== roomsN * childrenPerRoom) {
    throw new Error(
      `Guest paxType counts must match search: need ${roomsN * adultsPerRoom} adult(s) (paxType 1) and ${roomsN * childrenPerRoom} child(ren) (paxType 2); got ${inferredAdults} adult(s) and ${inferredChildren} child(ren).`
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
  const preBookBody: Record<string, unknown> = {
    BookingCode: bookingCode,
    TokenId:     tokenId,
    TraceId:     traceId,
  };
  const paymentMode = String(process.env.TBO_HOTEL_PREBOOK_PAYMENT_MODE ?? "Limit").trim() || "Limit";
  preBookBody.PaymentMode = paymentMode;

  try {
    preBookRaw = await tboPost("/PreBook", preBookBody as Record<string, any>);
  } catch (err: any) {
    throw Object.assign(
      new Error(`PreBook failed before Book: ${err.message}`),
      { code: err.code }
    );
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

  // Use the BookingCode from PreBook room if TBO updated it
  const finalBookingCode = (room?.BookingCode != null ? String(room.BookingCode).trim() : "") || bookingCode;

  const bookingCodes = new Set(
    [String(bookingCode).trim(), String(finalBookingCode).trim()].filter(Boolean)
  );
  const aggregated = aggregateFareForRooms(hotelResult, bookingCodes, roomsN, {
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

  const HotelRoomsDetails = Array.from({ length: roomsN }, (_, r) => ({
    HotelPassenger: guests
      .slice(r * paxPerRoom, (r + 1) * paxPerRoom)
      .map((g) => guestToTboPassenger(g)),
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
      ClientReferenceId:      `pt-${randomUUID().replace(/-/g, "")}`.slice(0, 40),
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
    console.log("[hotel-book] Final /Book payload:", JSON.stringify({
      attempt:                    strat.label,
      BookingCode:                body.BookingCode,
      TraceId:                    body.TraceId,
      NetAmount:                  body.NetAmount,
      Taxes:                      body.Taxes,
      IsVoucherBooking:           body.IsVoucherBooking,
      IsPackageFare:              body.IsPackageFare,
      IsPackageDetailsMandatory:  body.IsPackageDetailsMandatory,
      GuestNationality:           body.GuestNationality,
      EndUserIp:                  body.EndUserIp,
      HotelRoomsCount:            HotelRoomsDetails.length,
      PaxPerRoom:                 paxPerRoom,
    }, null, 2));
    try {
      return await tboPostWithClient(httpHotelBook, "/Book", body);
    } catch (e: any) {
      lastBookErr = e;
      if (!isInvalidNetAmountMessage(e?.message || "")) throw e;
      console.warn(`[hotel-book] /Book "${strat.label}" rejected:`, e?.message);
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
  return tboPostWithClient(httpHotelBook, "/GetBookingDetails", {
    BookingId: input.bookingId,
    TokenId:   tokenId,
  });
}

/* ------------------------------------------------------------------ */
/* CancelBooking  POST /Cancel                                        */
/* Uses the Book host (HotelBE) — same as /Book                      */
/* ------------------------------------------------------------------ */

export async function cancelHotelBooking(input: {
  bookingId:   string;
  requestType: 1 | 4;
}) {
  const tokenId = await authenticate();
  return tboPostWithClient(httpHotelBook, "/Cancel", {
    BookingId:   input.bookingId,
    RequestType: input.requestType,
    Remarks:     "Cancelled by user",
    TokenId:     tokenId,
  });
}
