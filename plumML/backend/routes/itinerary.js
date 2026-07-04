const express = require("express");
const router = express.Router();

const { getSession } = require("../utils/sessionStore");
const { extractSlotsAndReply, REQUIRED_SLOTS } = require("../services/geminiService");
const { runTripPipeline } = require("../services/tripPipeline");
const { getCheapestFlights } = require("../services/flightService");

/**
 * POST /api/chat
 * body: { sessionId: string, message: string }
 *
 * Drives the conversational slot-filling. Once every required slot is filled,
 * it automatically kicks off the full search + itinerary + PDF pipeline and
 * returns the result in the same response (so the frontend doesn't need a
 * separate "generate" click, though /api/generate-trip is also exposed below
 * for a manual "Build my trip" button).
 */
router.post("/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId and message are required" });
    }

    const session = getSession(sessionId);
    const { reply, slots, ready } = await extractSlotsAndReply(session.history, message, session.slots);

    session.history.push({ role: "user", text: message });
    session.history.push({ role: "assistant", text: reply });
    session.slots = { ...session.slots, ...slots };

    if (!ready) {
      return res.json({ reply, slots: session.slots, ready: false });
    }

    // Validate strict input format: departDate must be plain 'yyyy-MM-dd'
    const depart = session.slots?.departDate;
    if (typeof depart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(depart)) {
      return res.status(400).json({ error: "departDate must be a string in 'yyyy-MM-dd' format" });
    }

    // All slots collected — run the full pipeline right away.
    const result = await runTripPipeline(session.slots, sessionId);
    session.result = result;

    return res.json({
      reply,
      slots: session.slots,
      ready: true,
      tripReady: true,
      pdfUrl: result.pdfUrl,
      itinerary: result.itinerary,
      priceBreakdown: {
        flightTotal: result.combo.flightTotal,
        hotelTotal: result.combo.hotelTotal,
        total: result.combo.total,
        overBudget: result.combo.overBudget,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

/**
 * POST /api/generate-trip
 * body: { sessionId: string }
 * Manually (re)runs the pipeline for a session whose slots are already complete —
 * useful for a "Regenerate" button in the UI.
 */
router.post("/generate-trip", async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);

    const missing = REQUIRED_SLOTS.filter((k) => session.slots[k] === null || session.slots[k] === undefined);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    const result = await runTripPipeline(session.slots, sessionId);
    session.result = result;

    res.json({
      pdfUrl: result.pdfUrl,
      itinerary: result.itinerary,
      priceBreakdown: {
        flightTotal: result.combo.flightTotal,
        hotelTotal: result.combo.hotelTotal,
        total: result.combo.total,
        overBudget: result.combo.overBudget,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

/**
 * GET /api/session/:sessionId
 * Lets the frontend rehydrate chat history + slots on reload.
 */
router.get("/session/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  res.json(session);
});

module.exports = router;

// Dev-only: accept raw flight search JSON and return normalized flights
router.post("/debug/flight-search", async (req, res) => {
  try {
    const payload = req.body;
    // Minimal validation
    if (!payload || !payload.origin || !payload.destination || !payload.departDate) {
      return res.status(400).json({ error: "origin, destination and departDate are required" });
    }

    const flights = await getCheapestFlights(payload);
    res.json(flights);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});
