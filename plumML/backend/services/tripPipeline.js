const { getCheapestFlights } = require("./flightService");
const { getCheapestHotels, nightsBetween } = require("./hotelService");
const { pickBestRoundTripCombo } = require("../utils/priceCalculator");
const { generateItinerary } = require("./geminiService");
const { getImageForQuery } = require("./unsplashService");
const { generateItineraryPdf } = require("./pdfService");
const { resolveCityCode, resolveAirportCode } = require("../utils/cityCodeMap");
const config = require("../config/config");

async function runTripPipeline(slots, sessionId) {
  console.log(
    `[tripPipeline] runTripPipeline start for session=${sessionId} origin=${slots.originCity} destination=${slots.destinationCity} destCityCode=${slots.destinationCityCode}`
  );
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

  // 1. Fetch outbound flight, return flight, and hotels in parallel.
  console.log('[tripPipeline] fetching outbound/return flights and hotels in parallel');
  const [outboundFlights, hotels, returnFlights] = await Promise.all([
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
    getCheapestFlights({
      origin: destAirportCode,
      destination: originCode,
      departDate: slots.returnDate,
      adults: slots.adults,
      children: slots.children,
      topN: 20,
    }),
  ]);
  console.log(
    `[tripPipeline] fetched outboundFlights=${outboundFlights.length} returnFlights=${returnFlights.length} hotels=${hotels.length}`
  );

  if (!outboundFlights.length) throw new Error("No outbound flights found for the requested route/date.");
  if (!returnFlights.length) throw new Error("No return flights found for the selected return date.");
  if (!hotels.length) throw new Error("No hotels found for the requested destination/dates.");

  // 2. Pick the best outbound + return + hotel combination that fits the stated budget.
  const combo = pickBestRoundTripCombo({
    outboundFlights,
    returnFlights,
    hotels,
    adults: slots.adults,
    children: slots.children,
    budget: slots.budgetINR,
  });

  // 3. Ask Gemini to write a real day-wise itinerary grounded in the booked flight/hotel.
  const itinerary = await generateItinerary({
    slots,
    outboundFlight: combo.outboundFlight,
    returnFlight: combo.returnFlight,
    hotel: combo.hotel,
    nights,
  });

  // 4. Use a single hero photo only.
  const heroImageUrl = await getImageForQuery(`${slots.destinationCity} skyline travel`);

  // 5. Render the branded PDF.
  const minimumLocalSpend = Math.round(nights * 1500 * (slots.adults + slots.children));
  combo.minimumLocalSpend = minimumLocalSpend;
  combo.minimumLocalSpendPerLocation = (slots.destinationCity || "")
    .split(/,\s*/)
    .filter(Boolean)
    .reduce((acc, loc) => {
      acc[loc] = Math.round(minimumLocalSpend / Math.max((slots.destinationCity || "").split(/,\s*/).filter(Boolean).length, 1));
      return acc;
    }, {});
  combo.totalWithMinimumSpend = combo.total + minimumLocalSpend;

  const { fileName } = await generateItineraryPdf({
    slots,
    outboundFlight: combo.outboundFlight,
    returnFlight: combo.returnFlight,
    hotel: combo.hotel,
    combo,
    itinerary,
    heroImageUrl,
    sessionId,
  });

  return {
    itinerary,
    combo,
    flight: combo.outboundFlight,
    returnFlight: combo.returnFlight,
    hotel: combo.hotel,
    pdfUrl: `${config.publicBaseUrl}/generated/${fileName}`,
  };
}

module.exports = { runTripPipeline };
