import { Router } from "express";
import { getSession } from "../utils/plumml/sessionStore.js";
import { extractSlotsAndReply } from "../services/plumml/geminiService.js";
import { runTripPipeline } from "../services/plumml/tripPipeline.js";
import { AIPlannerSubmission } from "../models/aiplanner.model.js";

const router = Router();

function parseNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]+/g, "").trim();
    if (!cleaned) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildPlannerSubmissionPayload({
  sessionId,
  formValues,
  contactPhone,
  sessionSlots,
}: {
  sessionId: string;
  formValues?: Record<string, unknown>;
  contactPhone?: string | null;
  sessionSlots: Record<string, unknown>;
}) {
  return {
    sessionId,
    guestName:
      typeof sessionSlots.guestName === "string"
        ? sessionSlots.guestName
        : undefined,
    departureCity:
      typeof formValues?.departureCity === "string"
        ? formValues.departureCity
        : undefined,
    originCity:
      typeof sessionSlots.originCity === "string"
        ? sessionSlots.originCity
        : undefined,
    originAirportCode:
      typeof sessionSlots.originAirportCode === "string"
        ? sessionSlots.originAirportCode
        : undefined,
    destination:
      typeof formValues?.destination === "string"
        ? formValues.destination
        : undefined,
    destinationCity:
      typeof sessionSlots.destinationCity === "string"
        ? sessionSlots.destinationCity
        : undefined,
    destinationCityCode:
      typeof sessionSlots.destinationCityCode === "string"
        ? sessionSlots.destinationCityCode
        : undefined,
    destinationAirportCode:
      typeof sessionSlots.destinationAirportCode === "string"
        ? sessionSlots.destinationAirportCode
        : undefined,
    departDate:
      typeof sessionSlots.departDate === "string"
        ? sessionSlots.departDate
        : undefined,
    returnDate:
      typeof sessionSlots.returnDate === "string"
        ? sessionSlots.returnDate
        : undefined,
    adults:
      parseNumberValue(sessionSlots.adults ?? formValues?.adults) ?? undefined,
    children:
      parseNumberValue(sessionSlots.children ?? formValues?.children) ?? undefined,
    budget:
      parseNumberValue(formValues?.budget ?? sessionSlots.budgetINR) ?? undefined,
    budgetINR:
      parseNumberValue(sessionSlots.budgetINR ?? formValues?.budget) ?? undefined,
    tripVibe:
      typeof sessionSlots.tripVibe === "string"
        ? sessionSlots.tripVibe
        : typeof formValues?.tripVibe === "string"
        ? formValues.tripVibe
        : undefined,
    phoneNumber:
      typeof formValues?.phoneNumber === "string"
        ? formValues.phoneNumber
        : undefined,
    contactPhone:
      contactPhone ||
      (typeof formValues?.phoneNumber === "string"
        ? formValues.phoneNumber
        : undefined),
    specialRequests:
      typeof formValues?.specialRequests === "string"
        ? formValues.specialRequests
        : undefined,
    formValues: formValues || {},
  };
}

async function savePlannerSubmission(
  sessionId: string,
  formValues: Record<string, unknown> | undefined,
  contactPhone: string | null,
  sessionSlots: Record<string, unknown>
) {
  const payload = buildPlannerSubmissionPayload({
    sessionId,
    formValues,
    contactPhone,
    sessionSlots,
  });

  try {
    await AIPlannerSubmission.create(payload);
  } catch (saveError) {
    console.warn("[AIPlannerSubmission] failed to save submission:", saveError);
  }
}

router.post("/chat", async (req, res) => {
  try {
    const { sessionId, message, formValues, contactPhone } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId and message are required" });
    }

    const session = getSession(sessionId);
    const resolvedPhone = typeof contactPhone === "string" && contactPhone.trim()
      ? contactPhone.trim()
      : typeof formValues?.phoneNumber === "string" && formValues.phoneNumber.trim()
        ? formValues.phoneNumber.trim()
        : null;
    if (resolvedPhone) {
      session.slots.contactPhone = resolvedPhone;
    }
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
    const pdfUrl = result.pdfUrl ? `${baseUrl}${result.pdfUrl}` : undefined;
    session.result = { ...result, pdfUrl };

    await savePlannerSubmission(sessionId, formValues, resolvedPhone, session.slots);

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
    const { sessionId, formValues, contactPhone } = req.body;
    const session = getSession(sessionId);
    const resolvedPhone = typeof contactPhone === "string" && contactPhone.trim()
      ? contactPhone.trim()
      : typeof formValues?.phoneNumber === "string" && formValues.phoneNumber.trim()
        ? formValues.phoneNumber.trim()
        : null;
    if (resolvedPhone) {
      session.slots.contactPhone = resolvedPhone;
    }

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
    const pdfUrl = result.pdfUrl ? `${baseUrl}${result.pdfUrl}` : undefined;
    session.result = { ...result, pdfUrl };

    await savePlannerSubmission(sessionId, formValues, resolvedPhone, session.slots);

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

router.post("/submission", async (req, res) => {
  try {
    const { sessionId, formValues, contactPhone } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = getSession(sessionId);
    const resolvedPhone = typeof contactPhone === "string" && contactPhone.trim()
      ? contactPhone.trim()
      : typeof formValues?.phoneNumber === "string" && formValues.phoneNumber.trim()
        ? formValues.phoneNumber.trim()
        : null;

    await savePlannerSubmission(sessionId, formValues, resolvedPhone, session.slots);

    res.json({ ok: true });
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
