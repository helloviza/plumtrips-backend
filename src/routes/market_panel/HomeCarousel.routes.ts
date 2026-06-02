// apps/backend/src/routes/abx/home-carousel.ts
import express from "express";
import { z } from "zod";
import { HomeCarouselModel } from "../../models/HomeCarousel.model.js";
import { validate } from "../../mw/validate.middleware.js";
import { upload } from "../../mw/upload.middleware.js";
import { uploadImageToS3 } from "../../mw/s3upload.middleware.js";
import requireMarketingAdmin, { MarketingAuthedRequest } from "../../mw/requireMarketingAdmin.js";

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  image: z.string().optional(), // injected by uploadImageToS3
});

const updateSchema = createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const data = await HomeCarouselModel.find().populate("createdBy", "email").lean();
    const total = await HomeCarouselModel.countDocuments();
    res.json({ success: true, data, total });
  } catch (error) {
    console.error("[home-carousel list]", error);
    res.status(500).json({ success: false, error: "Failed to fetch carousel items" });
  }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const item = await HomeCarouselModel.findById(req.params.id)
      .populate("createdBy", "email")
      .lean();
    if (!item) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error("[home-carousel get]", error);
    res.status(500).json({ success: false, error: "Failed to fetch carousel item" });
  }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  requireMarketingAdmin,
  upload.single("image"),
  uploadImageToS3(),
  validate(createSchema),
  async (req: MarketingAuthedRequest, res: express.Response) => {
    try {
      if (!req.body.image) {
        return res.status(400).json({ success: false, error: "Image is required" });
      }
      const item = await HomeCarouselModel.create({
        ...req.body,
        createdBy: req.marketingAdminId,
      });
      res.status(201).json({ success: true, data: item.toObject() });
    } catch (error) {
      console.error("[home-carousel create]", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create carousel item",
      });
    }
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.put(
  "/:id",
  requireMarketingAdmin,
  upload.single("image"),
  uploadImageToS3(),
  validate(updateSchema),
  async (req: MarketingAuthedRequest, res: express.Response) => {
    try {
      const updated = await HomeCarouselModel.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ success: false, error: "Not found" });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("[home-carousel update]", error);
      res.status(500).json({ success: false, error: "Failed to update carousel item" });
    }
  }
);

// ─── DELETE ───────────────────────────────────────────────────────────────────

router.delete("/:id", requireMarketingAdmin, async (req: MarketingAuthedRequest, res) => {
  try {
    const deleted = await HomeCarouselModel.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("[home-carousel delete]", error);
    res.status(500).json({ success: false, error: "Failed to delete carousel item" });
  }
});

export default router;