import { searchHotelCities } from "../../services/plumml/plumtripsClient.js";

const DEMO_CITY_CODES: Record<string, string> = {
  osaka: "127343",
  tokyo: "115936",
  kyoto: "128243",
  chennai: "129002",
  newyork: "129001",
  newyorkcity: "129001",
  nyc: "129001",
};

const IATA_CODES: Record<string, string> = {
  mumbai: "BOM",
  delhi: "DEL",
  chennai: "MAA",
  bengaluru: "BLR",
  bangalore: "BLR",
  hyderabad: "HYD",
  kolkata: "CCU",
  tokyo: "HND",
  osaka: "KIX",
  kyoto: "UKY",
  newyork: "JFK",
  newyorkcity: "JFK",
  nyc: "JFK",
};

function normalizeCityKey(cityName: string | null | undefined) {
  return String(cityName || "").trim().toLowerCase().replace(/[\s\W_]+/g, "");
}

export async function resolveCityCode(cityName: string, countryCode?: string): Promise<string | null> {
  const key = normalizeCityKey(cityName);
  if (DEMO_CITY_CODES[key]) return DEMO_CITY_CODES[key];

  const response = await searchHotelCities(cityName, countryCode);
  const cityList =
    response?.CityList || response?.cities || response?.data?.CityList || response?.data?.cities || [];

  if (!Array.isArray(cityList)) return null;

  const exact = cityList.find(
    (city: any) => String(city?.Name || city?.name || "").trim().toLowerCase() === key
  );

  if (exact?.Code) return String(exact.Code);

  const first = cityList[0];
  return first?.Code ? String(first.Code) : null;
}

export function resolveAirportCode(cityName: string): string | null {
  const key = normalizeCityKey(cityName);
  return IATA_CODES[key] || null;
}
