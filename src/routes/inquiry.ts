import { Router, Request, Response } from "express";
import { z } from "zod";
import { Inquiry } from "../models/Inquiry.js";

const router = Router();

// Validation schema for incoming inquiries
const inquirySchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().optional().or(z.literal("")),
  phone: z.string().min(5, "Phone number is required"),
  destination: z.string().optional().or(z.literal("")),
  departureCity: z.string().optional().or(z.literal("")),
  budget: z.string().optional().or(z.literal("")),
  month: z.string().optional().or(z.literal("")),
  travelers: z.number().optional().or(z.literal(0)),
  formType: z.enum(["hero", "holiday", "general"]).default("general"),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = inquirySchema.parse(req.body);

    const newInquiry = new Inquiry(validatedData);
    await newInquiry.save();

    res.status(201).json({
      ok: true,
      message: "Inquiry saved successfully",
      data: newInquiry,
    });
  } catch (error: any) {
    console.error("[Inquiry Route] Error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        ok: false,
        message: "Validation Error",
        errors: error.errors,
      });
    }
    res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ ok: true, data: inquiries });
  } catch (error: any) {
    console.error("[Inquiry Route] GET Error:", error);
    res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

export default router;
