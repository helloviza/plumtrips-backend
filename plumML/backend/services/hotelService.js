const { getCityHotels, searchHotels } = require("./plumtripsClient");

const MAX_HOTEL_CODES_PER_SEARCH = 50;
const SEARCH_BATCH_CONCURRENCY = 5; // how many batches to fire in parallel

const STAR_MAP = {
  OneStar: 1,
  TwoStar: 2,
  ThreeStar: 3,
  FourStar: 4,
  FiveStar: 5,
  All: null,
};

function toStarRating(hotelRatingStr) {
  if (!hotelRatingStr) return null;
  return STAR_MAP[hotelRatingStr] ?? null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** PlumTrips hotel search wants plain YYYY-MM-DD, not a full datetime. */
function toHotelDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date passed to toHotelDate: ${dateInput}`);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nightsBetween(checkIn, checkOut) {
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  return Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}

/** Pick the lowest TotalFare room from a HotelResult's Rooms[] */
function pickCheapestRoom(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  return rooms.reduce((cheapest, room) => {
    const fare = Number(room?.TotalFare) || Infinity;
    const cheapestFare = cheapest ? Number(cheapest.TotalFare) || Infinity : Infinity;
    return fare < cheapestFare ? room : cheapest;
  }, null);
}

/** Build a lookup map of HotelCode -> static metadata (name, rating, address, geo) */
function buildHotelMetaMap(hotelsList) {
  const map = new Map();
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

/** Merge one HotelResult entry (pricing) with its static metadata */
function normalizeHotel(hotelResult, metaMap, nights) {
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
    image: null, // not provided by this API
    raw: hotelResult,
  };
}

function assertSearchParams(p) {
  const required = ["checkIn", "checkOut", "hotelCodes"];
  const missing = required.filter((k) => !p[k]);
  if (missing.length) {
    throw new Error(`searchHotels missing required params: ${missing.join(", ")}`);
  }
}

/** Run searchHotels in batches of MAX_HOTEL_CODES_PER_SEARCH, with limited concurrency */
async function searchHotelsBatched(hotelCodes, searchParams) {
  const batches = chunk(hotelCodes, MAX_HOTEL_CODES_PER_SEARCH);
  const allResults = [];

  for (let i = 0; i < batches.length; i += SEARCH_BATCH_CONCURRENCY) {
    const group = batches.slice(i, i + SEARCH_BATCH_CONCURRENCY);
    const groupResponses = await Promise.all(
      group.map((codes) => {
        const params = { ...searchParams, hotelCodes: codes.join(",") };
        try {
          assertSearchParams(params);
        } catch (e) {
          console.error("searchHotels param check failed:", e.message);
          return Promise.resolve(null);
        }
        return searchHotels(params).catch((err) => {
          console.error(
            "searchHotels batch failed:",
            err?.response?.status,
            JSON.stringify(err?.response?.data)
          );
          return null;
        });
      })
    );

    for (const resp of groupResponses) {
      const hotelResults =
        resp?.data?.HotelResult ||
        resp?.HotelResult ||
        resp?.data?.Response?.HotelResult ||
        [];
      if (Array.isArray(hotelResults)) {
        allResults.push(...hotelResults);
      }
    }
  }

  return allResults;
}

/**
 * Given a city code, fetch the hotel list for that city, price them for the
 * requested stay (batched in groups of 50 hotel codes), and return the
 * cheapest N normalized hotels.
 */
async function getCheapestHotels({
  cityCode,
  checkIn,
  checkOut,
  rooms = 1,
  adults = 2,
  nationality = "IN",
  topN = 10,
}) {
  const cityHotelsResp = await getCityHotels(cityCode);
  const hotelsList = cityHotelsResp?.data?.Hotels || cityHotelsResp?.Hotels || [];

  if (!Array.isArray(hotelsList) || hotelsList.length === 0) return [];

  const metaMap = buildHotelMetaMap(hotelsList);
  const hotelCodes = hotelsList.map((h) => h.HotelCode).filter(Boolean);

  if (hotelCodes.length === 0) return [];

  const hotelResults = await searchHotelsBatched(hotelCodes, {
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

  normalized.sort((a, b) => a.totalPrice - b.totalPrice);

  return normalized.slice(0, topN);
}

module.exports = {
  getCheapestHotels,
  normalizeHotel,
  buildHotelMetaMap,
  pickCheapestRoom,
  nightsBetween,
  toStarRating,
  toHotelDate,
};