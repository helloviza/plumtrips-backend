import express from "express";
import { z } from "zod";
import { TripInquiryModel, BudgetRange, TravelMonth } from "../../models/tripenquiry.model.js";
import { validate } from "../../mw/validate.middleware.js";

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const createSchema = z.object({
    destination: z.string().min(2, "Destination is required"),
    departureCity: z.string().min(2, "Departure city is required"),
    budget: z.nativeEnum(BudgetRange),
    month: z.nativeEnum(TravelMonth),
    travelers: z.coerce.number().min(1, "At least 1 traveler").max(20, "Contact us for large groups"),
});

const updateSchema = createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
    try {
        const data = await TripInquiryModel.find().sort({ createdAt: -1 }).lean();
        const total = await TripInquiryModel.countDocuments();
        res.json({ success: true, data, total });
    } catch (error) {
        console.error("[tripInquiry list]", error);
        res.status(500).json({ success: false, error: "Failed to fetch trip inquiries" });
    }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
    try {
        const item = await TripInquiryModel.findById(req.params.id).lean();
        if (!item) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: item });
    } catch (error) {
        console.error("[tripInquiry get]", error);
        res.status(500).json({ success: false, error: "Failed to fetch trip inquiry" });
    }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post("/", validate(createSchema), async (req, res) => {
    try {
        const item = await TripInquiryModel.create(req.body);
        res.status(201).json({ success: true, data: item.toObject() });
    } catch (error) {
        console.error("[tripInquiry create]", error);
        res.status(500).json({ success: false, error: "Failed to create trip inquiry" });
    }
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
router.put("/:id", validate(updateSchema), async (req, res) => {
    try {
        const updated = await TripInquiryModel.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
        if (!updated) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error("[tripInquiry update]", error);
        res.status(500).json({ success: false, error: "Failed to update trip inquiry" });
    }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
    try {
        const deleted = await TripInquiryModel.findByIdAndDelete(req.params.id).lean();
        if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: { deleted: true } });
    } catch (error) {
        console.error("[tripInquiry delete]", error);
        res.status(500).json({ success: false, error: "Failed to delete trip inquiry" });
    }
});

export default router;