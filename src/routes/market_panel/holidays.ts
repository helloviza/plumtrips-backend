// apps/backend/src/routes/abx/holidays.ts
import express from "express";
import { z } from "zod";
import { HolidayModel, HolidayScope } from "../../models/holiday.model.js";
import { validate } from "../../mw/validate.middleware.js";
import { upload } from "../../mw/upload.middleware.js";
import { uploadImageToS3 } from "../../mw/s3upload.middleware.js";
import requireMarketingAdmin, { MarketingAuthedRequest } from "../../mw/requireMarketingAdmin.js";

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  subtitle: z.string(),
  price: z.coerce.number().positive("Price must be > 0"),
  scope: z.nativeEnum(HolidayScope),
  trending: z.coerce.boolean(),
  active: z.coerce.boolean(),
  href: z.string().min(1, "Href is required"),
  image: z.string().optional(), // injected by uploadImageToS3
});

const updateSchema = createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const data = await HolidayModel.find().populate("createdBy", "email").lean();
    const total = await HolidayModel.countDocuments();
    res.json({ success: true, data, total });
  } catch (error) {
    console.error("[holidays list]", error);
    res.status(500).json({ success: false, error: "Failed to fetch holidays" });
  }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const item = await HolidayModel.findById(req.params.id)
      .populate("createdBy", "email")
      .lean();
    if (!item) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error("[holidays get]", error);
    res.status(500).json({ success: false, error: "Failed to fetch holiday" });
  }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  requireMarketingAdmin,
  upload.single("image"),
  uploadImageToS3,
  validate(createSchema),
  async (req: MarketingAuthedRequest, res:express.Response) => {
    try {
      if (!req.body.image) {
        return res.status(400).json({ success: false, error: "Image is required" });
      }
      const item = await HolidayModel.create({
        ...req.body,
        createdBy: req.marketingAdminId,
      });
      res.status(201).json({ success: true, data: item.toObject() });
    } catch (error) {
      console.error("[holidays create]", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create holiday",
      });
    }
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.put(
  "/:id",
  requireMarketingAdmin,
  upload.single("image"),
  uploadImageToS3,
  validate(updateSchema),
  async (req: MarketingAuthedRequest, res:express.Response) => {
    try {
      const updated = await HolidayModel.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ success: false, error: "Not found" });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("[holidays update]", error);
      res.status(500).json({ success: false, error: "Failed to update holiday" });
    }
  }
);

// ─── DELETE ───────────────────────────────────────────────────────────────────

router.delete("/:id", requireMarketingAdmin, async (req: MarketingAuthedRequest, res) => {
  try {
    const deleted = await HolidayModel.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("[holidays delete]", error);
    res.status(500).json({ success: false, error: "Failed to delete holiday" });
  }
});

export default router;