import type { TripDetailSegment } from "./flightComponent.js";
import {
  upper,
  TBO_ANY_TIME,
  rawSearch,
} from "./utilsFlight.js";
import type {RawSearchParams,PriceRBDParams} from "./flightComponent.js";
import type {SearchInput} from "./flightSanitizers.js";
import {JourneyType} from "./flightComponent.js";
import {FlightCabinClass} from "./flightComponent.js";
// ─── Types ─────────────────────────────────────────────────────────────────────


// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Convert SearchInput into the TBO Segments array + JourneyType. */
function buildSegments(input: SearchInput): Pick<RawSearchParams, "JourneyType" | "Segments"> {
  const {
    origin, destination, departDate, returnDate,
    tripType, segments: multiSegments,
    cabinClass = FlightCabinClass.Economy,
  } = input;

  const isMultiCity =
    tripType === "multiCity" &&
    Array.isArray(multiSegments) &&
    multiSegments.length >= 2;

  const seg = (orig: string, dest: string, date: string, cls = cabinClass): TripDetailSegment => ({
    Origin:                 upper(orig),
    Destination:            upper(dest),
    FlightCabinClass:       cls,
    PreferredDepartureTime: `${date}T${TBO_ANY_TIME}`,
    PreferredArrivalTime:   `${date}T${TBO_ANY_TIME}`,
  });

  if (isMultiCity) {
    return {
      JourneyType: JourneyType.MultiStop,
      Segments:    multiSegments!.map((s) => seg(s.origin, s.destination, s.departDate, s.cabinClass)),
    };
  }

  if (returnDate) {
    return {
      JourneyType: JourneyType.Return,
      Segments: [
        seg(origin!, destination!, departDate!),
        seg(destination!, origin!, returnDate),
      ],
    };
  }

  return {
    JourneyType: JourneyType.OneWay,
    Segments:    [seg(origin!, destination!, departDate!)],
  };
}




function handleSearchError(
  err: { ErrorCode?: number; ErrorMessage?: string } | undefined,
  traceId: string,
  label = "Search",
): { Response: object } | null {
  if (!err || !err.ErrorCode || err.ErrorCode === 0) return null;

  if (err.ErrorCode === 6 || err.ErrorCode === 25) {
    console.log(`[${label}] No flights found (ErrorCode ${err.ErrorCode}) — returning empty results`);
    return {
      Response: {
        ResponseStatus: 1,
        Error:          { ErrorCode: 0, ErrorMessage: "" },
        TraceId:        traceId,
        Results:        [],
        NoResultReason: err.ErrorMessage || "No flights found for this route/date",
      },
    };
  }

  throw new Error(err.ErrorMessage || `${label} failed (ErrorCode ${err.ErrorCode})`);
}

function normalizeSearchResults(rawResults: any): any[] {
  if (!Array.isArray(rawResults)) return [];
  return Array.isArray(rawResults[0]) ? rawResults.flat() : rawResults;
}



/** One-way, return, or multi-city flight search. */
export async function searchFlights(input: SearchInput) {
  const {
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false, oneStopOnly = false,
    preferredAirlines = [],
    fareType,
  } = input || {};

  const isMultiCity =
    input.tripType === "multiCity" &&
    Array.isArray(input.segments) &&
    input.segments.length >= 2;

  if (!isMultiCity && (!input.origin || !input.destination || !input.departDate)) {
    throw new Error("origin, destination, departDate are required");
  }

  const { JourneyType, Segments } = buildSegments(input);

  const params: RawSearchParams = {
    AdultCount:        Number(adults),
    ChildCount:        Number(children),
    InfantCount:       Number(infants),
    DirectFlight:      Boolean(nonStopOnly),
    OneStopFlight:     Boolean(oneStopOnly),
    JourneyType,
    Segments,
    PreferredAirlines: preferredAirlines.length ? preferredAirlines : null,
    ...(fareType && fareType !== "Regular" ? { FareType: fareType } : {}),
  };

  const data = await rawSearch(params);

  const empty = handleSearchError(data?.Response?.Error, data?.Response?.TraceId ?? "", "searchFlights");
  return empty ?? data;
}


// utils.ts — ADD this new exported function below searchFlights()

/**
 * Multi-city search via individual OneWay legs (parallel).
 * Returns an array of per-leg search results, each with its own TraceId.
 */
export async function searchMultiCityAsOneWay(input: SearchInput): Promise<{
  legs: Array<{
    legIndex: number;
    origin: string;
    destination: string;
    departDate: string;
    traceId: string;
    results: any[];
    raw: any;
  }>;
}> {
  const segments = input.segments;
  if (!Array.isArray(segments) || segments.length < 2) {
    throw new Error("multiCity requires at least 2 segments");
  }

  const {
    adults = 1, children = 0, infants = 0,
    nonStopOnly = false, oneStopOnly = false,
    preferredAirlines = [],
    fareType,
    cabinClass = FlightCabinClass.Economy,
  } = input;

  // Fire all legs in parallel
  const legPromises = segments.map((seg, idx) => {
    const params: RawSearchParams = {
      AdultCount:        Number(adults),
      ChildCount:        Number(children),
      InfantCount:       Number(infants),
      DirectFlight:      Boolean(nonStopOnly),
      OneStopFlight:     Boolean(oneStopOnly),
      JourneyType:       JourneyType.OneWay,                     // <-- always OneWay
      Segments: [{
        Origin:                 upper(seg.origin),
        Destination:            upper(seg.destination),
        FlightCabinClass:       seg.cabinClass ?? cabinClass,
        PreferredDepartureTime: `${seg.departDate}T${TBO_ANY_TIME}`,
        PreferredArrivalTime:   `${seg.departDate}T${TBO_ANY_TIME}`,
      }],
      PreferredAirlines: preferredAirlines.length ? preferredAirlines : null,
      ...(fareType && fareType !== "Regular" ? { FareType: fareType } : {}),
    };

    return rawSearch(params).then((data) => {
      const err = data?.Response?.Error;
      // Reuse existing error handler — returns empty on no-flights, throws on real errors
      const empty = handleSearchError(err, data?.Response?.TraceId ?? "", `leg${idx}`);
      const resolved = empty ?? data;
      return {
        legIndex:    idx,
        origin:      seg.origin,
        destination: seg.destination,
        departDate:  seg.departDate,
        traceId:     resolved?.Response?.TraceId ?? "",
        results:     normalizeSearchResults(resolved?.Response?.Results),
        raw:         resolved,
      };
    });
  });

  const legs = await Promise.all(legPromises);
  return { legs };
}



/** fare rules for a result. */



// flightSearch.ts — add this at the bottom

