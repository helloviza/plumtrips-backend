import { Router } from "express";
import { getSession } from "../utils/plumml/sessionStore.js";
import { extractSlotsAndReply } from "../services/plumml/geminiService.js";
import { runTripPipeline } from "../services/plumml/tripPipeline.js";

const router = Router();

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

    const depart = session.slots?.departDate;
    if (typeof depart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(depart)) {
      return res.status(400).json({ error: "departDate must be a string in 'yyyy-MM-dd' format" });
    }

    const result = await runTripPipeline(session.slots, sessionId);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pdfUrl = `${baseUrl}${result.pdfUrl}`;
    session.result = { ...result, pdfUrl };

    return res.json({
      reply,
      slots: session.slots,
      ready: true,
      tripReady: true,
      pdfUrl,
      itinerary: result.itinerary,
      outboundFlight: result.outboundFlight,
      returnFlight: result.returnFlight,
      hotel: result.hotel,
      priceBreakdown: {
        flightTotal: result.combo.flightTotal,
        hotelTotal: result.combo.hotelTotal,
        total: result.combo.total,
        minimumLocalSpend: result.combo.minimumLocalSpend,
        minimumLocalSpendPerLocation: result.combo.minimumLocalSpendPerLocation,
        totalWithMinimumSpend: result.combo.totalWithMinimumSpend,
        overBudget: result.combo.overBudget,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

router.post("/generate-trip", async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);

    const missing = [
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
    ].filter((k) => session.slots[k as keyof typeof session.slots] == null);

    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    const result = await runTripPipeline(session.slots, sessionId);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pdfUrl = `${baseUrl}${result.pdfUrl}`;
    session.result = { ...result, pdfUrl };

    res.json({
      pdfUrl,
      itinerary: result.itinerary,
      outboundFlight: result.outboundFlight,
      returnFlight: result.returnFlight,
      hotel: result.hotel,
      priceBreakdown: {
        flightTotal: result.combo.flightTotal,
        hotelTotal: result.combo.hotelTotal,
        total: result.combo.total,
        minimumLocalSpend: result.combo.minimumLocalSpend,
        minimumLocalSpendPerLocation: result.combo.minimumLocalSpendPerLocation,
        totalWithMinimumSpend: result.combo.totalWithMinimumSpend,
        overBudget: result.combo.overBudget,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

router.get("/session/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  res.json(session);
});

export default router;
