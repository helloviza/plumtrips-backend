export type PlannerSlotValues = {
  guestName: string | null;
  originCity: string | null;
  originAirportCode: string | null;
  destinationCity: string | null;
  destinationCityCode: string | null;
  destinationAirportCode: string | null;
  departDate: string | null;
  returnDate: string | null;
  adults: number | null;
  children: number | null;
  budgetINR: number | null;
  tripVibe: string | null;
};

export type PlannerHistoryEntry = {
  role: "user" | "assistant";
  text: string;
};

export type PlannerSession = {
  history: PlannerHistoryEntry[];
  slots: PlannerSlotValues;
  result: Record<string, unknown> | null;
};

const sessions = new Map<string, PlannerSession>();

export function getSession(sessionId: string): PlannerSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      slots: {
        guestName: null,
        originCity: null,
        originAirportCode: null,
        destinationCity: null,
        destinationCityCode: null,
        destinationAirportCode: null,
        departDate: null,
        returnDate: null,
        adults: null,
        children: null,
        budgetINR: null,
        tripVibe: null,
      },
      result: null,
    });
  }
  return sessions.get(sessionId)!;
}
