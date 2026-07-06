export type FlightOffer = {
  price: number;
};

export type HotelOffer = {
  totalPrice: number;
};

export type RoundTripCombo = {
  outboundFlight: FlightOffer;
  returnFlight: FlightOffer;
  hotel: HotelOffer;
  flightTotal: number;
  hotelTotal: number;
  total: number;
  overBudget: boolean;
  currency: string;
  minimumLocalSpend?: number;
  minimumLocalSpendPerLocation?: Record<string, number>;
  totalWithMinimumSpend?: number;
};

export function pickBestRoundTripCombo({
  outboundFlights,
  returnFlights,
  hotels,
  adults,
  children = 0,
  budget,
  considerTop = 6,
}: {
  outboundFlights: FlightOffer[];
  returnFlights: FlightOffer[];
  hotels: HotelOffer[];
  adults: number;
  children?: number;
  budget?: number | null;
  considerTop?: number;
}): RoundTripCombo {
  const paxForFlight = adults + children;
  const shortlistOutbound = outboundFlights.slice(0, considerTop);
  const shortlistReturn = returnFlights.slice(0, considerTop);
  const shortlistHotels = hotels.slice(0, considerTop);

  let best: RoundTripCombo | null = null;
  let cheapestOverall: RoundTripCombo | null = null;

  for (const outbound of shortlistOutbound) {
    for (const inbound of shortlistReturn) {
      const flightTotal = paxForFlight * (Number(outbound.price) + Number(inbound.price));
      for (const hotel of shortlistHotels) {
        const total = flightTotal + hotel.totalPrice;
        const combo: RoundTripCombo = {
          outboundFlight: outbound,
          returnFlight: inbound,
          hotel,
          flightTotal,
          hotelTotal: hotel.totalPrice,
          total,
          overBudget: false,
          currency: "INR",
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
  if (!chosen) {
    throw new Error("Unable to choose a round-trip combo from the provided offers.");
  }

  return {
    ...chosen,
    overBudget: !!budget && chosen.total > budget,
  };
}

export function formatINR(amount: number | string): string {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
