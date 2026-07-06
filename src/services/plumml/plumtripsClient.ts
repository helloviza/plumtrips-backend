import axios from "axios";
import { plannerConfig } from "../../config/planner.js";

const client = axios.create({
  baseURL: plannerConfig.plumtrips.baseUrl,
  timeout: 70000,
  headers: {
    "Content-Type": "application/json",
  },
});

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

export async function searchFlights(payload: unknown): Promise<any> {
  const { data } = await client.post("/flights/tbo/search", payload);
  return data;
}

export async function getCityHotels(cityCode: string): Promise<any> {
  const { data } = await client.post("/hotels/city-hotels", { cityCode });
  return data;
}

export async function searchHotelCities(query: string, countryCode?: string): Promise<any> {
  const params = new URLSearchParams({ query: String(query || "").trim() });
  if (countryCode) params.set("countryCode", String(countryCode).trim().toUpperCase());
  const { data } = await client.get(`/hotels/cities?${params.toString()}`);
  return data;
}

export async function searchHotels(payload: unknown): Promise<any> {
  const { data } = await client.post("/hotels/search", payload);
  return data;
}
