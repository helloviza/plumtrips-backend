import axios from "axios";
/**
 * Keep the exact TBO bases you were using when it worked.
 * - Authenticate:  http://Sharedapi.tektravels.com/SharedData.svc/rest   (HTTP)
 * - Flights:       https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest
 */
export const SHARED_BASE = process.env.TBO_SHARED_BASE_URL ||
    "http://Sharedapi.tektravels.com/SharedData.svc/rest";
export const FLIGHT_BASE = process.env.TBO_FLIGHT_BASE_URL ||
    "https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest";
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
/** Helpers that other files already import */
export function withTimeout(ms) {
    return { timeout: ms };
}
export function axiosMessage(err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const msg = data?.Response?.Error?.ErrorMessage ||
        data?.Error?.ErrorMessage ||
        data?.message ||
        err?.message ||
        "Request failed";
    return status ? `HTTP ${status} ${msg}` : msg;
}
