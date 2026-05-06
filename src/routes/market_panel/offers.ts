// apps/backend/src/routes/abx/offers.ts
import express from "express";
import { z } from "zod";
import { OfferModel, OfferType } from "../../models/offer.model.js";
import { validate } from "../../mw/validate.middleware.js";
import { upload } from "../../mw/upload.middleware.js";
import { uploadImageToS3 } from "../../mw/s3upload.middleware.js";
import requireMarketingAdmin, { MarketingAuthedRequest } from "../../mw/requireMarketingAdmin.js";

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
// NOTE: offers use "img" (not "image") to match the OfferDocument schema.

const createSchema = z.object({
  type: z.nativeEnum(OfferType),
  title: z.string().min(1, "Title is required"),
  subtitle: z.string(),
  active: z.coerce.boolean(),
  img: z.string().optional(), // injected by uploadImageToS3("img")
});

const updateSchema = createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const data = await OfferModel.find().populate("createdBy", "email").lean();
    const total = await OfferModel.countDocuments();
    res.json({ success: true, data, total });
  } catch (error) {
    console.error("[offers list]", error);
    res.status(500).json({ success: false, error: "Failed to fetch offers" });
  }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const item = await OfferModel.findById(req.params.id)
      .populate("createdBy", "email")
      .lean();
    if (!item) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error("[offers get]", error);
    res.status(500).json({ success: false, error: "Failed to fetch offer" });
  }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  requireMarketingAdmin,
  upload.single("img"),        // field name matches OfferDocument.img
  uploadImageToS3("img"),      // injects S3 URL into req.body.img
  validate(createSchema),
  async (req: MarketingAuthedRequest, res:express.Response) => {
    try {
      if (!req.body.img) {
        return res.status(400).json({ success: false, error: "Image is required" });
      }
      const item = await OfferModel.create({
        ...req.body,
        createdBy: req.marketingAdminId,
      });
      res.status(201).json({ success: true, data: item.toObject() });
    } catch (error) {
      console.error("[offers create]", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create offer",
      });
    }
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.put(
  "/:id",
  requireMarketingAdmin,
  upload.single("img"),
  uploadImageToS3("img"),
  validate(updateSchema),
  async (req: MarketingAuthedRequest, res:express.Response) => {
    try {
      const updated = await OfferModel.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ success: false, error: "Not found" });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("[offers update]", error);
      res.status(500).json({ success: false, error: "Failed to update offer" });
    }
  }
);

// ─── DELETE ───────────────────────────────────────────────────────────────────

router.delete("/:id", requireMarketingAdmin, async (req: MarketingAuthedRequest, res:express.Response) => {
  try {
    const deleted = await OfferModel.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("[offers delete]", error);
    res.status(500).json({ success: false, error: "Failed to delete offer" });
  }
});

export default router;