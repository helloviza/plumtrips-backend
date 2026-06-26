import axios from "axios";

/**
 * Keep the exact TBO bases you were using when it worked.
 * - Authenticate:  http://Sharedapi.tektravels.com/SharedData.svc/rest   (HTTP)
 * - Flights:       https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest
 */
export const SHARED_BASE =
  process.env.TBO_SHARED_BASE_URL ||
  "http://Sharedapi.tektravels.com/SharedData.svc/rest";

export const FLIGHT_BASE =
  process.env.TBO_FLIGHT_BASE_URL ||
  "https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest";



/** Hotel Search / PreBook / GetBookingDetails / Cancel — affiliate HotelAPI (typical) */
export const HOTEL_BASE =
  process.env.TBO_HOTEL_BASE_URL ||
  "https://affiliate.tektravels.com/HotelAPI";

/** Hotel final Book only — `HotelService.svc/rest/Book` (see TBO HotelService docs) */
export const HOTEL_BOOK_BASE =
  process.env.TBO_HOTEL_BOOK_BASE_URL ||
  "http://HotelApi.tektravels.com/BookingEngineService_Hotel/HotelService.svc/rest";

/**
 * Hotel Cancel (SendChangeRequest / GetChangeRequestStatus)
 * Docs: https://apidoc.tektravels.com/hotelnew/HotelSendChange.aspx
 * Host: https://HotelBE.tektravels.com/hotelservice.svc/rest
 */
export const HOTEL_CANCEL_BASE =
  process.env.TBO_HOTEL_CANCEL_BASE_URL ||
  "https://HotelBE.tektravels.com/hotelservice.svc/rest";

export const HOTEL_STATIC_BASE =
  process.env.TBO_HOTEL_STATIC_BASE_URL ||
  "http://api.tbotechnology.in/TBOHolidays_HotelAPI";

/** One place to control HTTP timeouts (90s default) */
const TIMEOUT = Number(process.env.TBO_HTTP_TIMEOUT_MS || 90_000);

export const httpShared = axios.create({
  baseURL: SHARED_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});

export const httpFlight = axios.create({
  baseURL: FLIGHT_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});

import { attachLoggingInterceptor } from "./apiLogger.js";

export const httpHotel = axios.create({
  baseURL: HOTEL_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});
attachLoggingInterceptor(httpHotel, "Hotel API");

export const httpHotelStatic = axios.create({
  baseURL: HOTEL_STATIC_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});
attachLoggingInterceptor(httpHotelStatic, "Hotel Static API");

export const httpHotelBook = axios.create({
  baseURL: HOTEL_BOOK_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});
attachLoggingInterceptor(httpHotelBook, "Hotel Book API");

/** Dedicated client for TBO hotel cancel (SendChangeRequest / GetChangeRequestStatus) */
export const httpHotelCancel = axios.create({
  baseURL: HOTEL_CANCEL_BASE,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  timeout: TIMEOUT,
});
attachLoggingInterceptor(httpHotelCancel, "Hotel Cancel API");


/** Helpers that other files already import */
export function withTimeout(ms: number) {
  return { timeout: ms };
}

export function axiosMessage(err: any) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const msg =
    data?.Response?.Error?.ErrorMessage ||
    data?.Error?.ErrorMessage ||
    data?.message ||
    err?.message ||
    "Request failed";
  return status ? `HTTP ${status} ${msg}` : msg;
}
