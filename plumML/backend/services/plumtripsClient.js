const axios = require("axios");
const config = require("../config/config");

/**
 * Thin wrapper around PlumTrips REST endpoints.
 * If PlumTrips requires auth, add the header below (Authorization / x-api-key)
 * once you know the exact scheme they expect.
 */
const client = axios.create({
  baseURL: config.plumtrips.baseUrl,
  timeout: 70000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Log full request + response detail on any failure so 400s are debuggable
// instead of showing up only as "Request failed with status code 400".
client.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error("=== PlumTrips API error ===");
    console.error("URL:", err?.config?.method?.toUpperCase(), err?.config?.baseURL + err?.config?.url);
    console.error("Request body:", err?.config?.data);
    console.error("Status:", err?.response?.status);
    console.error("Response data:", JSON.stringify(err?.response?.data, null, 2));
    console.error("============================");
    return Promise.reject(err);
  }
);

async function searchFlights(payload) {
  // payload example:
  // { origin, destination, departDate, cabinClass, adults, children, infants, nonStopOnly, fareType, tripType }
  const { data } = await client.post("/flights/tbo/search", payload);
  return data;
}

async function getCityHotels(cityCode) {
  const { data } = await client.post("/hotels/city-hotels", { cityCode });
  return data;
}

async function searchHotelCities(query, countryCode) {
  const params = new URLSearchParams({ query: String(query || "").trim() });
  if (countryCode) params.set("countryCode", String(countryCode).trim().toUpperCase());
  const { data } = await client.get(`/hotels/cities?${params.toString()}`);
  return data;
}

async function searchHotels(payload) {
  // payload example (SHAPE UNCONFIRMED — adjust once real 400 body is seen):
  // { hotelCodes, checkIn, checkOut, rooms, adults, nationality }
  const { data } = await client.post("/hotels/search", payload);
  return data;
}

module.exports = { searchFlights, getCityHotels, searchHotels, searchHotelCities };