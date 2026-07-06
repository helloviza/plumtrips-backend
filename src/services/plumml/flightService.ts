import { searchFlights } from "./plumtripsClient.js";

function pickFare(f: any): number {
  return (
    Number(f?.Fare?.OfferedFare) ||
    Number(f?.Fare?.PublishedFare) ||
    Number(f?.fare?.totalFare) ||
    Number(f?.fare?.publishedFare) ||
    Number(f?.totalFare) ||
    Number(f?.price) ||
    0
  );
}

function pickAirline(f: any): string {
  return (
    f?.ValidatingAirline ||
    f?.AirlineCode ||
    f?.airline?.name ||
    f?.airlineName ||
    f?.Segments?.[0]?.[0]?.Airline?.AirlineName ||
    "Airline"
  );
}

function pickFlightNumber(f: any): string {
  return f?.Segments?.[0]?.[0]?.Airline?.FlightNumber || f?.flightNumber || "";
}

function pickTimes(f: any) {
  const segs = f?.Segments?.[0] || [];
  const dep = segs[0]?.Origin?.DepTime || null;
  const arr = segs[segs.length - 1]?.Destination?.ArrTime || null;
  return { departureTime: dep, arrivalTime: arr };
}

function normalizeFlight(raw: any) {
  const { departureTime, arrivalTime } = pickTimes(raw);
  return {
    id: raw?.ResultIndex || raw?.id || `${pickAirline(raw)}-${pickFlightNumber(raw)}-${Math.random()}`,
    airline: pickAirline(raw),
    flightNumber: pickFlightNumber(raw),
    stops: raw?.Segments?.[0] ? raw.Segments[0].length - 1 : 0,
    departureTime,
    arrivalTime,
    price: Number(pickFare(raw)) || 0,
    resultIndex: raw?.ResultIndex,
    isRefundable: raw?.IsRefundable,
    baseFare: raw?.Fare?.BaseFare,
    tax: raw?.Fare?.Tax,
    currency: raw?.Fare?.Currency,
    raw,
  };
}

function extractFlightList(rawData: any): any[] {
  return (
    rawData?.data?.Response?.Results?.[0] ||
    rawData?.Response?.Results?.[0] ||
    []
  );
}

function extractFlightResults(rawData: any) {
  const list = extractFlightList(rawData);
  return list.map(normalizeFlight).filter((f: any) => f.price > 0);
}

function getSingleFare(rawData: any, { index, resultIndex }: { index?: number; resultIndex?: string } = {}) {
  const list = extractFlightList(rawData);
  if (list.length === 0) return null;

  let target = null;
  if (resultIndex) {
    target = list.find((f: any) => f.ResultIndex === resultIndex);
  } else if (typeof index === "number") {
    target = list[index];
  } else {
    target = list.reduce((min: any, f: any) => (pickFare(f) < pickFare(min) ? f : min));
  }

  if (!target) return null;

  return {
    fare: target.Fare?.OfferedFare,
    baseFare: target.Fare?.BaseFare,
    tax: target.Fare?.Tax,
    currency: target.Fare?.Currency,
    publishedFare: target.Fare?.PublishedFare,
    airline: pickAirline(target),
    flightNumber: pickFlightNumber(target),
    resultIndex: target.ResultIndex,
    isRefundable: target.IsRefundable,
  };
}

export async function getCheapestFlights({
  origin,
  destination,
  departDate,
  returnDate,
  adults,
  children = 0,
  cabinClass = 2,
  nonStopOnly = false,
  topN = 10,
}: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  cabinClass?: number;
  nonStopOnly?: boolean;
  topN?: number;
}): Promise<any[]> {
  if (typeof departDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    throw new Error("Invalid departDate. Expected format 'yyyy-MM-dd'.");
  }

  const payload = {
    origin,
    destination,
    departDate,
    cabinClass,
    adults,
    children,
    infants: 0,
    nonStopOnly,
    fareType: "Regular",
    tripType: returnDate ? "roundTrip" : "oneWay",
    ...(returnDate ? { returnDate } : {}),
  };

  const data = await searchFlights(payload);
  const list = extractFlightList(data);

  if (list.length === 0) {
    console.log("[flightService] Empty flight list. Raw response:", JSON.stringify(data, null, 2));
  }

  const normalized = extractFlightResults(data);
  normalized.sort((a: any, b: any) => a.price - b.price);
  return normalized.slice(0, topN);
}

export async function getSingleCheapestFare({
  origin,
  destination,
  departDate,
  adults,
  children = 0,
  cabinClass = 2,
  nonStopOnly = false,
}: {
  origin: string;
  destination: string;
  departDate: string;
  adults: number;
  children?: number;
  cabinClass?: number;
  nonStopOnly?: boolean;
}): Promise<any | null> {
  if (typeof departDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    throw new Error("Invalid departDate. Expected format 'yyyy-MM-dd'.");
  }

  const payload = {
    origin,
    destination,
    departDate,
    cabinClass,
    adults,
    children,
    infants: 0,
    nonStopOnly,
    fareType: "Regular",
    tripType: "oneWay",
  };

  const data = await searchFlights(payload);
  return getSingleFare(data);
}

export { normalizeFlight, extractFlightResults, getSingleFare };
