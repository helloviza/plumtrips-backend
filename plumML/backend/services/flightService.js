const { searchFlights } = require("./plumtripsClient");
const { toApiDateTime } = require("../utils/dateUtils");

/**
 * PlumTrips returns raw TBO-style flight results. The exact field names can vary
 * slightly by provider config, so this normalizer defensively looks for the most
 * common shapes. If your live response differs, adjust the `pick*` helpers below —
 * everything else in the app only depends on the normalized shape returned here.
 */
function pickFare(f) {
  return (
    f?.Fare?.OfferedFare ??
    f?.Fare?.PublishedFare ??
    f?.fare?.totalFare ??
    f?.fare?.publishedFare ??
    f?.totalFare ??
    f?.price ??
    0
  );
}

function pickAirline(f) {
  return (
    f?.ValidatingAirline ||
    f?.AirlineCode ||
    f?.airline?.name ||
    f?.airlineName ||
    f?.Segments?.[0]?.[0]?.Airline?.AirlineName ||
    "Airline"
  );
}

function pickFlightNumber(f) {
  return f?.Segments?.[0]?.[0]?.Airline?.FlightNumber || f?.flightNumber || "";
}

function pickTimes(f) {
  const segs = f?.Segments?.[0] || [];
  const dep = segs[0]?.Origin?.DepTime || null;
  const arr = segs[segs.length - 1]?.Destination?.ArrTime || null;
  return { departureTime: dep, arrivalTime: arr };
}

function normalizeFlight(raw) {
  const { departureTime, arrivalTime } = pickTimes(raw);
  return {
    id: raw?.ResultIndex || raw?.id || `${pickAirline(raw)}-${pickFlightNumber(raw)}-${Math.random()}`,
    airline: pickAirline(raw),
    flightNumber: pickFlightNumber(raw),
    stops: raw?.Segments?.[0] ? raw.Segments[0].length - 1 : 0,
    departureTime,
    arrivalTime,
    price: Number(pickFare(raw)) || 0,
    resultIndex: raw?.ResultIndex,
    isRefundable: raw?.IsRefundable,
    baseFare: raw?.Fare?.BaseFare,
    tax: raw?.Fare?.Tax,
    currency: raw?.Fare?.Currency,
    raw,
  };
}

/**
 * The actual list of flight offers lives at Response.Results[0].
 * (Results is an array-of-arrays in the TBO-style payload.)
 */
function extractFlightList(rawData) {
  return (
    rawData?.data?.Response?.Results?.[0] ||  // actual shape: { ok, data: { Response: { Results } } }
    rawData?.Response?.Results?.[0] ||        // fallback if unwrapped upstream
    []
  );
}

function extractFlightResults(rawData) {
  const list = extractFlightList(rawData);
  return list.map(normalizeFlight).filter((f) => f.price > 0);
}

/**
 * Return just ONE flight's fare info — cheapest by default.
 */
function getSingleFare(rawData, { index, resultIndex } = {}) {
  const list = extractFlightList(rawData);
  if (list.length === 0) return null;

  let target;
  if (resultIndex) {
    target = list.find((f) => f.ResultIndex === resultIndex);
  } else if (typeof index === "number") {
    target = list[index];
  } else {
    target = list.reduce((min, f) => (pickFare(f) < pickFare(min) ? f : min));
  }

  if (!target) return null;

  return {
    fare: target.Fare?.OfferedFare,
    baseFare: target.Fare?.BaseFare,
    tax: target.Fare?.Tax,
    currency: target.Fare?.Currency,
    publishedFare: target.Fare?.PublishedFare,
    airline: pickAirline(target),
    flightNumber: pickFlightNumber(target),
    resultIndex: target.ResultIndex,
    isRefundable: target.IsRefundable,
  };
}

/**
 * Search flights and return the top N cheapest, normalized, sorted ascending.
 * IMPORTANT: this MUST keep returning an array — tripPipeline.js and other
 * callers depend on that contract.
 */
async function getCheapestFlights({ origin, destination, departDate, returnDate, adults, children = 0, cabinClass = 2, nonStopOnly = false, topN = 10 }) {
  if (typeof departDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    throw new Error("Invalid departDate. Expected format 'yyyy-MM-dd'.");
  }
  if (returnDate && typeof returnDate !== "string") {
    throw new Error("Invalid returnDate. Expected format 'yyyy-MM-dd'.");
  }

  const payload = {
    origin,
    destination,
    departDate,
    cabinClass,
    adults,
    children,
    infants: 0,
    nonStopOnly,
    fareType: "Regular",
    tripType: returnDate ? "roundTrip" : "oneWay",
    ...(returnDate ? { returnDate } : {}),
  };

  console.log("[flightService] searchFlights payload:", JSON.stringify(payload, null, 2));
  const data = await searchFlights(payload);

  const list = extractFlightList(data);

  if (list.length === 0) {
    // Log the raw response so you can tell WHY it's empty:
    // API error, no availability, wrong param names, etc.
    console.log("[flightService] Empty flight list. Raw response:", JSON.stringify(data, null, 2));
  } else {
    console.log("[flightService] extracted flight items:", list.length);
  }

  const normalized = extractFlightResults(data);
  normalized.sort((a, b) => a.price - b.price);

  return normalized.slice(0, topN);
}

/**
 * Convenience wrapper: search flights and return just ONE fare (cheapest by default).
 * Use this separately wherever you only need a single price, without touching
 * the array-based getCheapestFlights used by tripPipeline.
 */
async function getSingleCheapestFare({ origin, destination, departDate, adults, children = 0, cabinClass = 2, nonStopOnly = false }) {
  if (typeof departDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    throw new Error("Invalid departDate. Expected format 'yyyy-MM-dd'.");
  }

  const payload = {
    origin,
    destination,
    departDate,
    cabinClass,
    adults,
    children,
    infants: 0,
    nonStopOnly,
    fareType: "Regular",
    tripType: "oneWay",
  };

  const data = await searchFlights(payload);
  return getSingleFare(data);
}

module.exports = {
  getCheapestFlights,      // array-returning, used by tripPipeline — unchanged contract
  getSingleCheapestFare,   // new, returns one fare object or null
  getSingleFare,           // pure helper if you already have `data`
  normalizeFlight,
  extractFlightResults,
};