const { getCheapestFlights } = require("./flightService");
const { getCheapestHotels, nightsBetween } = require("./hotelService");
const { pickBestCombo } = require("../utils/priceCalculator");
const { generateItinerary } = require("./geminiService");
const { attachItineraryImages, getImageForQuery } = require("./unsplashService");
const { generateItineraryPdf } = require("./pdfService");
const { resolveCityCode, resolveAirportCode } = require("../utils/cityCodeMap");
const config = require("../config/config");

async function runTripPipeline(slots, sessionId) {
  const originCode = slots.originAirportCode || resolveAirportCode(slots.originCity);
  const destAirportCode = slots.destinationAirportCode || resolveAirportCode(slots.destinationCity);
  const destCityCode = slots.destinationCityCode || (await resolveCityCode(slots.destinationCity));

  if (!originCode || !destAirportCode) {
    throw new Error(
      `Could not resolve IATA airport codes for "${slots.originCity}" / "${slots.destinationCity}". Please ask the user for the airport code directly, or extend utils/cityCodeMap.js.`
    );
  }
  if (!destCityCode) {
    throw new Error(
      `Could not resolve PlumTrips city code for "${slots.destinationCity}". Extend utils/cityCodeMap.js or wire up PlumTrips' real city-lookup endpoint.`
    );
  }

  const nights = nightsBetween(slots.departDate, slots.returnDate);

  // 1. Fetch flights + hotels in parallel (each returns up to 100-200 raw results,
  //    normalized + sorted ascending by price inside the service).
  const [flights, hotels] = await Promise.all([
    getCheapestFlights({
      origin: originCode,
      destination: destAirportCode,
      departDate: slots.departDate,
      adults: slots.adults,
      children: slots.children,
      topN: 20,
    }),
    getCheapestHotels({
      cityCode: destCityCode,
      checkIn: slots.departDate,
      checkOut: slots.returnDate,
      rooms: Math.max(1, Math.ceil((slots.adults + slots.children) / 3)),
      adults: slots.adults,
      topN: 20,
    }),
  ]);

  if (!flights.length) throw new Error("No flights found for the requested route/date.");
  if (!hotels.length) throw new Error("No hotels found for the requested destination/dates.");

  // 2. Pick the best flight+hotel combination that fits the stated budget.
  const combo = pickBestCombo({
    flights,
    hotels,
    adults: slots.adults,
    children: slots.children,
    budget: slots.budgetINR,
  });

  // 3. Ask Gemini to write a real day-wise itinerary grounded in the booked flight/hotel.
  const itinerary = await generateItinerary({ slots, flight: combo.flight, hotel: combo.hotel, nights });

  // 4. Attach a real photo to every activity (Unsplash), plus one hero image.
  await attachItineraryImages(itinerary, slots.destinationCity);
  const heroImageUrl = await getImageForQuery(`${slots.destinationCity} skyline travel`);

  // 5. Render the branded PDF.
  const { fileName } = await generateItineraryPdf({
    slots,
    flight: combo.flight,
    hotel: combo.hotel,
    combo,
    itinerary,
    heroImageUrl,
    sessionId,
  });

  return {
    itinerary,
    combo,
    flight: combo.flight,
    hotel: combo.hotel,
    pdfUrl: `${config.publicBaseUrl}/generated/${fileName}`,
  };
}

module.exports = { runTripPipeline };
