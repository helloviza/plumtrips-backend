import { getCheapestFlights } from "./flightService.js";
import { getCheapestHotels, nightsBetween } from "./hotelService.js";
import { pickBestRoundTripCombo } from "../../utils/plumml/priceCalculator.js";
import { generateItinerary } from "./geminiService.js";
import { getImageForQuery } from "./unsplashService.js";
import { generateItineraryPdf } from "./pdfService.js";
import { resolveCityCode, resolveAirportCode } from "../../utils/plumml/cityCodeMap.js";
import { plannerConfig } from "../../config/planner.js";

export async function runTripPipeline(slots: any, sessionId: string) {
  const originCode = slots.originAirportCode || resolveAirportCode(slots.originCity);
  const destAirportCode = slots.destinationAirportCode || resolveAirportCode(slots.destinationCity);
  const destCityCode = slots.destinationCityCode || (await resolveCityCode(slots.destinationCity));

  if (!originCode || !destAirportCode) {
    throw new Error(
      `Could not resolve IATA airport codes for "${slots.originCity}" / "${slots.destinationCity}".`
    );
  }
  if (!destCityCode) {
    throw new Error(
      `Could not resolve PlumTrips city code for "${slots.destinationCity}".`
    );
  }

  const nights = nightsBetween(slots.departDate, slots.returnDate);

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

  if (!outboundFlights.length) throw new Error("No outbound flights found for the requested route/date.");
  if (!returnFlights.length) throw new Error("No return flights found for the selected return date.");
  if (!hotels.length) throw new Error("No hotels found for the requested destination/dates.");

  const combo = pickBestRoundTripCombo({
    outboundFlights,
    returnFlights,
    hotels,
    adults: slots.adults,
    children: slots.children,
    budget: slots.budgetINR,
  });

  const itinerary = await generateItinerary({
    slots,
    outboundFlight: combo.outboundFlight,
    returnFlight: combo.returnFlight,
    hotel: combo.hotel,
    nights,
  });

  const heroImageUrl = await getImageForQuery(`${slots.destinationCity} skyline travel`);

  const minimumLocalSpend = Math.round(nights * 1500 * (slots.adults + slots.children));
  combo.minimumLocalSpend = minimumLocalSpend;
  combo.minimumLocalSpendPerLocation = (slots.destinationCity || "")
    .split(/,\s*/)
    .filter(Boolean)
    .reduce((acc: Record<string, number>, loc: string) => {
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
    outboundFlight: combo.outboundFlight,
    returnFlight: combo.returnFlight,
    hotel: combo.hotel,
    pdfUrl: `/generated/${fileName}`,
  };
}
