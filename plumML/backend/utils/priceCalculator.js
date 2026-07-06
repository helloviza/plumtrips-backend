/**
 * Picks the best flight+hotel combo:
 *  - Considers the cheapest `considerTop` flights x cheapest `considerTop` hotels
 *    (keeps it fast even when the raw search returns 100-200 results, since both
 *    input arrays are already pre-sorted ascending by getCheapestFlights/Hotels).
 *  - Prefers the combo with the highest total that still fits the budget
 *    (best use of budget without exceeding it).
 *  - If nothing fits the budget, falls back to the single cheapest combo and
 *    flags `overBudget: true` so the UI/PDF can be transparent about it.
 */
function pickBestCombo({ flights, hotels, adults, children = 0, budget, considerTop = 8 }) {
  const paxForFlight = adults + children;
  const shortlistFlights = flights.slice(0, considerTop);
  const shortlistHotels = hotels.slice(0, considerTop);

  let best = null;
  let cheapestOverall = null;

  for (const flight of shortlistFlights) {
    const flightTotal = flight.price * paxForFlight;
    for (const hotel of shortlistHotels) {
      const total = flightTotal + hotel.totalPrice;
      const combo = { flight, hotel, flightTotal, hotelTotal: hotel.totalPrice, total };

      if (!cheapestOverall || combo.total < cheapestOverall.total) {
        cheapestOverall = combo;
      }

      if (budget && combo.total <= budget) {
        if (!best || combo.total > best.total) best = combo; // best use of budget
      } else if (!budget) {
        if (!best || combo.total < best.total) best = combo; // no budget given -> just cheapest
      }
    }
  }

  const chosen = best || cheapestOverall;
  return {
    ...chosen,
    overBudget: !!budget && chosen.total > budget,
    currency: "INR",
  };
}

function pickBestRoundTripCombo({ outboundFlights, returnFlights, hotels, adults, children = 0, budget, considerTop = 6 }) {
  const paxForFlight = adults + children;
  const shortlistOutbound = outboundFlights.slice(0, considerTop);
  const shortlistReturn = returnFlights.slice(0, considerTop);
  const shortlistHotels = hotels.slice(0, considerTop);

  let best = null;
  let cheapestOverall = null;

  for (const outbound of shortlistOutbound) {
    for (const inbound of shortlistReturn) {
      const flightTotal = paxForFlight * (Number(outbound.price) + Number(inbound.price));
      for (const hotel of shortlistHotels) {
        const total = flightTotal + hotel.totalPrice;
        const combo = {
          outboundFlight: outbound,
          returnFlight: inbound,
          hotel,
          flightTotal,
          hotelTotal: hotel.totalPrice,
          total,
        };

        if (!cheapestOverall || combo.total < cheapestOverall.total) {
          cheapestOverall = combo;
        }

        if (budget && combo.total <= budget) {
          if (!best || combo.total > best.total) best = combo;
        } else if (!budget) {
          if (!best || combo.total < best.total) best = combo;
        }
      }
    }
  }

  const chosen = best || cheapestOverall;
  return {
    ...chosen,
    overBudget: !!budget && chosen.total > budget,
    currency: "INR",
  };
}

function formatINR(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

module.exports = { pickBestCombo, pickBestRoundTripCombo, formatINR };
