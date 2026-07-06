/**
 * PlumTrips' internal `cityCode` (used by /hotels/city-hotels) isn't a public
 * standard like IATA codes, so it has to be resolved from PlumTrips' own city
 * lookup/autocomplete endpoint. That endpoint wasn't provided, so this file is a
 * small stand-in map you should extend, OR swap `resolveCityCode` below to call
 * PlumTrips' real city-search endpoint once you have its URL.
 */
const DEMO_CITY_CODES = {
  osaka: "127343",
  tokyo: "115936", // placeholder — replace with the real PlumTrips code
  kyoto: "128243", // placeholder — replace with the real PlumTrips code
  chennai: "129002", // placeholder — add the real PlumTrips city code when available
  newyork: "129001", // placeholder — add the real PlumTrips city code when available
  newyorkcity: "129001",
  nyc: "129001",
};

const IATA_CODES = {
  mumbai: "BOM",
  delhi: "DEL",
  chennai: "MAA",
  bengaluru: "BLR",
  bangalore: "BLR",
  hyderabad: "HYD",
  kolkata: "CCU",
  tokyo: "HND",
  osaka: "KIX",
  kyoto: "UKY", // Kyoto has no airport; nearest is Osaka(KIX)/Itami(ITM) — adjust per real usage
  newyork: "JFK",
  newyorkcity: "JFK",
  nyc: "JFK",
};

const { searchHotelCities } = require("../services/plumtripsClient");

function normalizeCityKey(cityName) {
  return String(cityName || "").trim().toLowerCase().replace(/[\s\W_]+/g, "");
}

async function resolveCityCode(cityName, countryCode) {
  const key = normalizeCityKey(cityName);
  if (DEMO_CITY_CODES[key]) return DEMO_CITY_CODES[key];

  const response = await searchHotelCities(cityName, countryCode);
  const cityList =
    response?.CityList ||
    response?.cities ||
    response?.data?.CityList ||
    response?.data?.cities ||
    [];

  if (!Array.isArray(cityList)) return null;

  const exact = cityList.find(
    (city) => String(city.Name || city.name || "").trim().toLowerCase() === key
  );
  if (exact?.Code) return String(exact.Code);

  const first = cityList[0];
  return first?.Code ? String(first.Code) : null;
}

function resolveAirportCode(cityName) {
  const key = normalizeCityKey(cityName);
  return IATA_CODES[key] || null;
}

module.exports = { resolveCityCode, resolveAirportCode, DEMO_CITY_CODES, IATA_CODES };
