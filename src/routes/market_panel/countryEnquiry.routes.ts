import express from "express";
import { z } from "zod";
import { CountryEnquiryModel } from "../../models/countryEnquiry.model.js";
import { validate } from "../../mw/validate.middleware.js";

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const createSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email is required"),
    teamSize: z.coerce.number().min(10, "Minimum team size is 10"),
    date: z.string().min(1, "Date is required"),
    note: z.string().optional(),
});

const updateSchema = createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
    try {
        const data = await CountryEnquiryModel.find().sort({ createdAt: -1 }).lean();
        const total = await CountryEnquiryModel.countDocuments();
        res.json({ success: true, data, total });
    } catch (error) {
        console.error("[countryEnquiry list]", error);
        res.status(500).json({ success: false, error: "Failed to fetch country enquiries" });
    }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
    try {
        const item = await CountryEnquiryModel.findById(req.params.id).lean();
        if (!item) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: item });
    } catch (error) {
        console.error("[countryEnquiry get]", error);
        res.status(500).json({ success: false, error: "Failed to fetch country enquiry" });
    }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post("/", validate(createSchema), async (req, res) => {
    try {
        const item = await CountryEnquiryModel.create(req.body);
        res.status(201).json({ success: true, data: item.toObject() });
    } catch (error) {
        console.error("[countryEnquiry create]", error);
        res.status(500).json({ success: false, error: "Failed to create country enquiry" });
    }
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
router.put("/:id", validate(updateSchema), async (req, res) => {
    try {
        const updated = await CountryEnquiryModel.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        ).lean();
        if (!updated) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error("[countryEnquiry update]", error);
        res.status(500).json({ success: false, error: "Failed to update country enquiry" });
    }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
    try {
        const deleted = await CountryEnquiryModel.findByIdAndDelete(req.params.id).lean();
        if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
        res.json({ success: true, data: { deleted: true } });
    } catch (error) {
        console.error("[countryEnquiry delete]", error);
        res.status(500).json({ success: false, error: "Failed to delete country enquiry" });
    }
});

export default router;