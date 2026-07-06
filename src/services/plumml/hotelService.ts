import { getCityHotels, searchHotels } from "./plumtripsClient.js";

const MAX_HOTEL_CODES_PER_SEARCH = 50;
const SEARCH_BATCH_CONCURRENCY = 5;
const MAX_HOTEL_BATCHES_TO_RUN = 6;
const MAX_HOTEL_CODES_TO_SEARCH = MAX_HOTEL_CODES_PER_SEARCH * MAX_HOTEL_BATCHES_TO_RUN;

const STAR_MAP: Record<string, number | null> = {
  OneStar: 1,
  TwoStar: 2,
  ThreeStar: 3,
  FourStar: 4,
  FiveStar: 5,
  All: null,
};

function toStarRating(hotelRatingStr: string | null | undefined): number | null {
  if (!hotelRatingStr) return null;
  return STAR_MAP[hotelRatingStr] ?? null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function toHotelDate(dateInput: string | Date): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date passed to toHotelDate: ${dateInput}`);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

function pickCheapestRoom(rooms: any[]): any {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  return rooms.reduce((cheapest: any, room: any) => {
    const fare = Number(room?.TotalFare) || Infinity;
    const cheapestFare = cheapest ? Number(cheapest.TotalFare) || Infinity : Infinity;
    return fare < cheapestFare ? room : cheapest;
  }, null);
}

function buildHotelMetaMap(hotelsList: any[]) {
  const map = new Map<string, any>();
  for (const h of hotelsList) {
    const code = h?.HotelCode;
    if (!code) continue;
    map.set(String(code), {
      hotelCode: String(code),
      name: h.HotelName || "Hotel",
      starRating: toStarRating(h.HotelRating),
      address: h.Address?.trim() || "",
      cityName: h.CityName || "",
      countryName: h.CountryName || "",
      countryCode: h.CountryCode || "",
      latitude: h.Latitude ? Number(h.Latitude) : null,
      longitude: h.Longitude ? Number(h.Longitude) : null,
    });
  }
  return map;
}

function normalizeHotel(hotelResult: any, metaMap: Map<string, any>, nights: number) {
  const code = String(hotelResult?.HotelCode || "");
  const meta = metaMap.get(code) || {
    hotelCode: code,
    name: "Hotel",
    starRating: null,
    address: "",
    cityName: "",
    countryName: "",
    countryCode: "",
    latitude: null,
    longitude: null,
  };

  const cheapestRoom = pickCheapestRoom(hotelResult?.Rooms);
  if (!cheapestRoom) return null;

  const totalPrice = Number(cheapestRoom.TotalFare) || 0;
  const totalTax = Number(cheapestRoom.TotalTax) || 0;

  return {
    ...meta,
    currency: hotelResult?.Currency || "INR",
    totalPrice,
    totalTax,
    pricePerNight: nights ? Math.round(totalPrice / nights) : totalPrice,
    roomType: Array.isArray(cheapestRoom.Name) ? cheapestRoom.Name[0] : cheapestRoom.Name || "Standard Room",
    mealPlan: cheapestRoom.MealType || "Room_Only",
    isRefundable: !!cheapestRoom.IsRefundable,
    inclusions: cheapestRoom.Inclusion || "",
    promotions: cheapestRoom.RoomPromotion || [],
    bookingCode: cheapestRoom.BookingCode,
    image: null,
    raw: hotelResult,
  };
}

function assertSearchParams(p: Record<string, unknown>) {
  const required = ["checkIn", "checkOut", "hotelCodes"];
  const missing = required.filter((k) => !p[k]);
  if (missing.length) {
    throw new Error(`searchHotels missing required params: ${missing.join(", ")}`);
  }
}

async function searchHotelsBatched(hotelCodes: string[], searchParams: Record<string, unknown>) {
  const batches = chunk(hotelCodes, MAX_HOTEL_CODES_PER_SEARCH);
  const limitedBatches = batches.slice(0, MAX_HOTEL_BATCHES_TO_RUN);
  const allResults: any[] = [];

  for (let i = 0; i < limitedBatches.length; i += SEARCH_BATCH_CONCURRENCY) {
    const group = limitedBatches.slice(i, i + SEARCH_BATCH_CONCURRENCY);
    const groupResponses = await Promise.all(
      group.map(async (codes) => {
        const params = { ...searchParams, hotelCodes: codes.join(",") };
        assertSearchParams(params);
        try {
          return await searchHotels(params);
        } catch (err) {
          console.error("searchHotels batch failed:", err);
          return null;
        }
      })
    );

    for (const resp of groupResponses) {
      const hotelResults =
        resp?.data?.HotelResult || resp?.HotelResult || resp?.data?.Response?.HotelResult || [];
      if (Array.isArray(hotelResults)) {
        allResults.push(...hotelResults);
      }
    }
  }

  return allResults;
}

export async function getCheapestHotels({
  cityCode,
  checkIn,
  checkOut,
  rooms = 1,
  adults = 2,
  nationality = "IN",
  topN = 10,
}: {
  cityCode: string;
  checkIn: string;
  checkOut: string;
  rooms?: number;
  adults?: number;
  nationality?: string;
  topN?: number;
}): Promise<any[]> {
  const cityHotelsResp = await getCityHotels(cityCode);
  const hotelsList = cityHotelsResp?.data?.Hotels || cityHotelsResp?.Hotels || [];
  if (!Array.isArray(hotelsList) || hotelsList.length === 0) return [];

  const hotelCodes = hotelsList.map((h: any) => h.HotelCode).filter(Boolean);
  if (hotelCodes.length === 0) return [];

  const cappedHotelCodes = hotelCodes.slice(0, MAX_HOTEL_CODES_TO_SEARCH);
  const metaMap = buildHotelMetaMap(hotelsList);
  const hotelResults = await searchHotelsBatched(cappedHotelCodes, {
    checkIn: toHotelDate(checkIn),
    checkOut: toHotelDate(checkOut),
    rooms,
    adults,
    nationality,
  });

  const nights = nightsBetween(checkIn, checkOut);

  const normalized = hotelResults
    .map((h) => normalizeHotel(h, metaMap, nights))
    .filter((h) => h && h.totalPrice > 0);

  normalized.sort((a: any, b: any) => a.totalPrice - b.totalPrice);
  return normalized.slice(0, topN);
}

export { toHotelDate, nightsBetween, toStarRating };
