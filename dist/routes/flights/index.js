// apps/backend/src/routes/flights/index.ts
import { Router } from "express";
import { searchFlights, getFareRule, getFareQuote, bookFlight, ticketFlight, getBookingDetails, } from "../../services/tbo/flight.service.js";
import { authenticate, _authBodyForDebug, } from "../../services/tbo/auth.service.js";
import { httpShared, httpFlight, SHARED_BASE, FLIGHT_BASE, axiosMessage, withTimeout, } from "../../lib/http.js";
const r = Router();
const ok = (data) => ({ ok: true, data });
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
/* ------------------------------------------------------------------ */
/* Auth diagnostics                                                    */
/* ------------------------------------------------------------------ */
/** Quick check: confirms /Authenticate works and shows which base URLs are in use. */
r.get("/tbo/_auth-debug", async (_req, res) => {
    try {
        const token = await authenticate();
        res.json(ok({
            tokenPreview: token ? `${String(token).slice(0, 8)}…` : "(no token)",
            sharedBase: SHARED_BASE,
            flightBase: FLIGHT_BASE,
            body: _authBodyForDebug(true), // masked
        }));
    }
    catch (e) {
        res
            .status(400)
            .json(fail(axiosMessage(e), {
            sharedBase: SHARED_BASE,
            flightBase: FLIGHT_BASE,
            body: _authBodyForDebug(true), // masked
        }));
    }
});
/** Deep probe: calls TBO /Authenticate and relays the raw response. */
r.get("/tbo/_auth-raw", async (_req, res) => {
    try {
        const { data, status } = await httpShared.post("/Authenticate", _authBodyForDebug(false), withTimeout(60_000));
        res.status(status || 200).json(data);
    }
    catch (e) {
        const status = e?.response?.status || 500;
        res.status(status).json(e?.response?.data || { message: axiosMessage(e) });
    }
});
/* Optional: raw Search probe that posts directly to TBO with a minimal body built here.
   Useful for comparing what TBO returns vs your wrapped /tbo/search endpoint. */
r.post("/tbo/_search-raw", async (req, res) => {
    try {
        const token = await authenticate();
        const { EndUserIp } = _authBodyForDebug(false);
        const { origin, destination, departDate, returnDate, cabinClass = 1, adults = 1, children = 0, infants = 0, 
        // Keep sources null unless your tenant requires explicit sources.
        sources = null, nonStopOnly = false, oneStopOnly = false, preferredAirlines = [], } = req.body || {};
        if (!origin || !destination || !departDate) {
            return res.status(400).json(fail("origin, destination, departDate are required"));
        }
        const seg = (date, o, d) => ({
            Origin: String(o || "").toUpperCase(),
            Destination: String(d || "").toUpperCase(),
            FlightCabinClass: String(cabinClass),
            PreferredDepartureTime: `${date}T00:00:00`,
            PreferredArrivalTime: `${date}T00:00:00`,
        });
        const Segments = [seg(departDate, origin, destination)];
        const JourneyType = returnDate ? "2" : "1";
        if (returnDate)
            Segments.push(seg(returnDate, destination, origin));
        const body = {
            EndUserIp,
            TokenId: token,
            AdultCount: String(adults),
            ChildCount: String(children),
            InfantCount: String(infants),
            DirectFlight: nonStopOnly ? "true" : "false",
            OneStopFlight: oneStopOnly ? "true" : "false",
            JourneyType,
            PreferredAirlines: Array.isArray(preferredAirlines) && preferredAirlines.length
                ? preferredAirlines
                : null,
            Segments,
            Sources: sources && Array.isArray(sources) && sources.length ? sources : null,
        };
        const { data, status } = await httpFlight.post("/Search", body);
        res.status(status || 200).json(data);
    }
    catch (e) {
        res
            .status(e?.response?.status || 500)
            .json(e?.response?.data || { message: axiosMessage(e) });
    }
});
/* ------------------------------------------------------------------ */
/* Core Flight endpoints (wrap services)                               */
/* ------------------------------------------------------------------ */
r.post("/tbo/search", async (req, res) => {
    try {
        const data = await searchFlights(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
r.post("/tbo/fare-rule", async (req, res) => {
    try {
        const data = await getFareRule(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
r.post("/tbo/fare-quote", async (req, res) => {
    try {
        const data = await getFareQuote(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
r.post("/tbo/book", async (req, res) => {
    try {
        const data = await bookFlight(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
r.post("/tbo/ticket", async (req, res) => {
    try {
        const data = await ticketFlight(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
r.post("/tbo/booking-details", async (req, res) => {
    try {
        const data = await getBookingDetails(req.body);
        res.json(ok(data));
    }
    catch (e) {
        res.status(400).json(fail(axiosMessage(e)));
    }
});
export default r;
