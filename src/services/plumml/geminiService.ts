import axios from "axios";
import { plannerConfig } from "../../config/planner.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const REQUIRED_SLOTS = [
  "guestName",
  "originCity",
  "originAirportCode",
  "destinationCity",
  "destinationCityCode",
  "destinationAirportCode",
  "departDate",
  "returnDate",
  "adults",
  "children",
  "budgetINR",
  "tripVibe",
] as const;

async function callGemini(systemInstruction: string, userText: string, { jsonMode = false } = {}) {
  const url = `${BASE}/${plannerConfig.gemini.model}:generateContent?key=${plannerConfig.gemini.apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: jsonMode
      ? { responseMimeType: "application/json", temperature: 0.7 }
      : { temperature: 0.8 },
  };

  const { data } = await axios.post(url, body, { timeout: 30000 });
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  return text;
}

export async function extractSlotsAndReply(
  history: { role: "user" | "assistant"; text: string }[],
  latestMessage: string,
  currentSlots: Record<string, unknown>
) {
  const system = `You are "Plumtrips Planner", a friendly travel-planning chatbot for an Indian travel agency.
Your job across the conversation is to collect these trip fields from the user, one or two at a time,
in a natural conversational way (don't interrogate — be warm, like a travel concierge):

${REQUIRED_SLOTS.map((s) => `- ${s}`).join("\n")}

Notes:
- originAirportCode / destinationAirportCode are 3-letter IATA codes (infer from city names if you can, e.g. Mumbai -> BOM, Chennai -> MAA, Delhi -> DEL, Tokyo -> HND, Osaka -> KIX). If unsure, ask the user or leave null.
- destinationCityCode is the PlumTrips internal hotel city code — if you don't know it, leave it null; the backend will resolve it separately.
- budgetINR must be a plain number (no commas/symbols).
- tripVibe is short free text like "relaxed family beach trip", "adventure & nightlife", "cultural & food-focused", etc.
- adults/children default to null until stated.
- Already-known values (do not re-ask, just carry them forward and update if the user changes them):
${JSON.stringify(currentSlots, null, 2)}

Always respond with ONLY a JSON object, no markdown fences, shaped exactly as:
{
  "reply": "<your natural chat reply to the user, asking for whatever is still missing, or confirming you have everything>",
  "slots": { ...all fields above, filled with best-known values, null if unknown... },
  "ready": true | false   // true only when every field above is non-null and valid
}`;

  const convoText =
    history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n") +
    `\nUser: ${latestMessage}`;

  const raw = await callGemini(system, convoText, { jsonMode: true });
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {
      reply: "Sorry, could you rephrase that? I want to make sure I capture your trip details correctly.",
      slots: currentSlots,
      ready: false,
    };
  }
}

export async function generateItinerary({
  slots,
  outboundFlight,
  returnFlight,
  hotel,
  nights,
}: {
  slots: Record<string, any>;
  outboundFlight: Record<string, any>;
  returnFlight: Record<string, any>;
  hotel: Record<string, any>;
  nights: number;
}) {
  const system = `You are an expert travel itinerary writer for a luxury travel agency called Plumtrips.
Write a personalized, realistic, day-wise itinerary. Respond with ONLY valid JSON, no markdown fences, shaped as:

{
  "tripTitle": "string, e.g. '${slots.guestName}'s ${slots.destinationCity} Trip'",
  "summary": "2-3 sentence overview of the vibe of this trip",
  "days": [
    {
      "dayNumber": 1,
      "date": "YYYY-MM-DD",
      "title": "short theme for the day",
      "activities": [
        { "time": "Morning|Afternoon|Evening|Night", "place": "location name or area", "description": "1-2 sentence activity description" }
      ]
    }
  ]
}

Use exactly ${nights + 1} days (arrival day through departure day).
If the destination contains multiple cities separated by commas, treat this as a multi-city tour and spread the plan across those cities.
Do not include any image fields in the itinerary JSON. Use only one hero image in the PDF, not per activity.
Include details for both the outbound and return flights in the itinerary context.
Ground it in the real booked flight and hotel details given below, and match the traveler\'s requested vibe.`;

  const userText = `Trip details:
Guest: ${slots.guestName}
Travelers: ${slots.adults} adults, ${slots.children} children
Destination: ${slots.destinationCity}
Vibe requested: ${slots.tripVibe}
Arrival date: ${slots.departDate}
Return date: ${slots.returnDate}
Nights: ${nights}
Booked outbound flight: ${outboundFlight.airline} ${outboundFlight.flightNumber}, departing ${outboundFlight.departureTime || slots.departDate} and arriving ${outboundFlight.arrivalTime || slots.departDate}
Booked return flight: ${returnFlight.airline} ${returnFlight.flightNumber}, departing ${returnFlight.departureTime || slots.returnDate} and arriving ${returnFlight.arrivalTime || slots.returnDate}
Booked hotel: ${hotel.name} (${hotel.starRating || "N/A"}-star), room: ${hotel.roomType}, meal plan: ${hotel.mealPlan}`;

  const raw = await callGemini(system, userText, { jsonMode: true });
  return JSON.parse(raw);
}
