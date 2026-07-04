# Plumtrips AI Trip Planner

A chatbot-driven trip planner: a person chats naturally about their trip (name, origin,
destination, dates, travelers, budget, vibe), and the app:

1. Searches **live flights and hotels** via PlumTrips APIs (100-200 raw results each)
2. Picks the **cheapest flight + hotel combo** that fits the stated budget
3. Uses **Gemini** to write a real, grounded **day-wise itinerary**
4. Pulls a matching photo for every activity via **Unsplash**
5. Renders a **branded PDF** (same look as your Plumtrips.com sample) with guest name,
   real prices, hotel/flight details, and the full day-by-day plan with photos

No fake numbers: every price shown comes from the actual PlumTrips search response.

## Architecture

```
plumtrips-ai-planner/
├── backend/
│   ├── server.js                  # Express entrypoint
│   ├── config/config.js           # env-driven config
│   ├── routes/itinerary.js        # /api/chat, /api/generate-trip, /api/session/:id
│   ├── services/
│   │   ├── plumtripsClient.js     # raw axios calls to PlumTrips endpoints
│   │   ├── flightService.js       # normalize + sort cheapest flights
│   │   ├── hotelService.js        # city-hotels -> hotels/search, normalize + sort
│   │   ├── geminiService.js       # chat slot-filling + itinerary JSON generation
│   │   ├── unsplashService.js     # photo lookup per activity
│   │   ├── tripPipeline.js        # orchestrates all of the above
│   │   └── pdfService.js          # renders branded HTML -> PDF via puppeteer
│   ├── templates/itineraryTemplate.js  # the branded HTML used for the PDF
│   ├── utils/
│   │   ├── priceCalculator.js     # cheapest-combo-within-budget logic
│   │   ├── sessionStore.js        # in-memory chat session store
│   │   └── cityCodeMap.js         # city name -> IATA / PlumTrips cityCode (extend me)
│   └── public/generated/          # PDFs land here, served at /generated/<file>.pdf
└── frontend/
    ├── index.html / style.css / app.js   # plain JS chat UI (no build step)
```

## How the conversation works

`POST /api/chat` sends the full chat history + the user's latest message to Gemini with
a system prompt that asks it to (a) reply conversationally and (b) extract structured
trip fields as JSON (`reply`, `slots`, `ready`). The backend merges the new slots into
the session. Once every required field is filled (`ready: true`), the backend
automatically calls `tripPipeline.runTripPipeline(...)`, which:

- Calls `flights/tbo/search` and `hotels/city-hotels` → `hotels/search`
- Normalizes and sorts both result sets ascending by price
- Picks the best combo that fits the budget (`utils/priceCalculator.js`)
- Asks Gemini for a day-wise itinerary grounded in the *actual* booked flight/hotel
- Fetches an Unsplash photo per activity
- Renders the branded PDF and returns its URL

## Setup

```bash
cd backend
npm install
cp .env.example .env   # fill in your real keys below
npm start               # http://localhost:5000
```

Then just open `frontend/index.html` in a browser (or serve it with any static server —
e.g. `npx serve frontend`).

### Required keys (`backend/.env`)

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `UNSPLASH_ACCESS_KEY` | https://unsplash.com/developers → create an app |
| `PLUMTRIPS_API_KEY` | Your PlumTrips/TBO account — wire the exact auth header PlumTrips expects into `services/plumtripsClient.js` (currently sends it as `x-api-key`; change to `Authorization: Bearer ...` if that's what their API expects) |

## Things you'll need to adapt to your real PlumTrips responses

I built this from your sample PDF and the three endpoint/payload examples you gave —
I don't have live access to `api.plumtrips.com` to inspect real response shapes, so two
spots are intentionally defensive/stubbed and flagged with comments:

1. **`services/flightService.js` / `services/hotelService.js`** — the `pick*()` helper
   functions try several common field-name variants (e.g. `fare.totalFare` vs `price`).
   Log one real response and adjust these to match exactly.
2. **`utils/cityCodeMap.js`** — PlumTrips' `cityCode` (e.g. `127343` for Osaka in your
   sample) isn't a public standard, so it has to come from PlumTrips' own city
   lookup/autocomplete endpoint. Swap `resolveCityCode()` to call that endpoint once you
   have its URL, or keep extending the demo map.
3. **Auth header** — `services/plumtripsClient.js` assumes an `x-api-key` header; update
   it to whatever PlumTrips actually requires.

Everything else (price math, combo selection, Gemini prompts, PDF layout, images) works
end-to-end once those response shapes are confirmed.

## Notes on cost/scale

- Flight/hotel searches are capped to the cheapest 20 results server-side before
  building combos, so even if PlumTrips returns 100-200 raw results, combo selection
  stays fast (≤400 comparisons) instead of doing a full cartesian product.
- `pickBestCombo` maximizes budget usage without exceeding it; if nothing fits, it falls
  back to the single cheapest combo and marks `overBudget: true`, which both the chat
  UI and the PDF surface transparently (no hidden markup, no fake numbers).
- Puppeteer downloads a bundled Chromium on `npm install` — if you're deploying to a
  constrained environment (e.g. serverless), swap to `@sparticuz/chromium` or a hosted
  HTML-to-PDF API instead.

## Extending into a "real" chatbot UX

The current frontend is a straightforward chat list + input box. If you want richer
slot-filling (buttons for "how many travelers", a date picker, etc.) instead of pure
free text, keep the same `/api/chat` contract — just have the frontend render `slots`
returned in each response as inline UI, then keep sending user replies as before.
