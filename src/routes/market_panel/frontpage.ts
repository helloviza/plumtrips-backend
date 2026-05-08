import express from "express";
import {z} from "zod";
import {FrontpageModel, FrontpageScope} from "../../models/frontpage.model.js";
import {validate} from "../../mw/validate.middleware.js";
import {upload} from "../../mw/upload.middleware.js";
import {uploadImageToS3} from "../../mw/s3upload.middleware.js";
import requireMarketingAdmin, {MarketingAuthedRequest} from "../../mw/requireMarketingAdmin.js";

const router =express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const createSchema= z.object({
    scope: z.nativeEnum(FrontpageScope),
    title: z.string().min(1, "Title is required"),
    subtitle: z.string().min(1, "Subtitle is required"),
    tag_one: z.string().min(1, "Tag one is required"),
    tag_two: z.string().min(1, "Tag two is required"),
    extra_info: z.string().optional(),
    href: z.string().min(1, "Href is required"),
    image: z.string().optional(), // injected by uploadImageToS3
    trending: z.coerce.boolean(),
    active: z.coerce.boolean(),
});

const updateSchema= createSchema.partial();

// ─── GET ALL ──────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
    try {
        const data = await FrontpageModel.find().populate("createdBy", "email").lean();
        const total = await FrontpageModel.countDocuments();
        res.json({success: true, data, total});
    } catch (error) {
        console.error("[frontpage list]", error);
        res.status(500).json({success: false, error: "Failed to fetch frontpage items"});
    }
})

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
    try {
        const item = await FrontpageModel.findById(req.params.id).populate("createdBy", "email").lean();
        if (!item) return res.status(404).json({success: false, error: "Not found"});
        res.json({success: true, data: item});
    } catch (error) {
        console.error("[frontpage get]", error);
        res.status(500).json({success: false, error: "Failed to fetch frontpage item"});
    }
})

// ─── CREATE ───────────────────────────────────────────────────────────────────  
router.post("/", requireMarketingAdmin, upload.single("image"), uploadImageToS3(), validate(createSchema), async (req: MarketingAuthedRequest, res) => {
    try {
        if(!req.body.image){
            return res.status(400).json({success: false, error: "Image is required"});
        }
        const item = await FrontpageModel.create({
            ...req.body,
            createdBy: req.marketingAdminId,
        });
        res.status(201).json({success: true, data: item.toObject()});
    } catch (error) {
        console.error("[frontpage create]", error);
        res.status(500).json({success: false, error: "Failed to create frontpage item"});
    }
})

// ─── UPDATE ───────────────────────────────────────────────────────────────────
router.put("/:id", requireMarketingAdmin, upload.single("image"), uploadImageToS3(), validate(updateSchema), async (req: MarketingAuthedRequest, res) => {
    try {
        const updateData= await FrontpageModel.findByIdAndUpdate(req.params.id, req.body, {new: true}).lean();
        if (!updateData) return res.status(404).json({success: false, error: "Not found"});
        res.json({success: true, data: updateData});
    } catch (error) {
        console.error("[frontpage update]", error);
        res.status(500).json({success: false, error: "Failed to update frontpage item"});
    }   
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", requireMarketingAdmin, async (req, res) => {
    try {
        const deleted = await FrontpageModel.findByIdAndDelete(req.params.id).lean();
        if (!deleted) return res.status(404).json({success: false, error: "Not found"});
        res.json({success: true, data: {deleted:true}});
    } catch (error) {
        console.error("[frontpage delete]", error);
        res.status(500).json({success: false, error: "Failed to delete frontpage item"});
    }
});

export default router;