import { Router, Request, Response } from "express";
import {
  validateCallbackRequest,
  hasCallbackErrors,
  buildCallbackPayload,
  isCallbackRequest,
} from "../../models/request.model.js";

const router = Router();

// POST /api/abx/requests
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!isCallbackRequest(body)) {
      return res.status(400).json({ success: false, message: "Invalid request body." });
    }
    const errors = validateCallbackRequest(body);
    if (hasCallbackErrors(errors)) {
      return res.status(422).json({ success: false, message: "Validation failed.", errors });
    }
    const source = (req.headers["x-source"] as string) ?? "footer";
    const payload = buildCallbackPayload(body, source);

    // TODO: await CallbackRequestService.create(payload);
    const requestId = `CB-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    return res.status(201).json({ success: true, message: "We'll be in touch within 24 hours.", requestId });
  } catch (error) {
    console.error("[requests] POST error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

// GET /api/abx/requests
router.get("/", async (_req: Request, res: Response) => {
  try {
    const requests: unknown[] = []; // TODO: await CallbackRequestService.findAll();
    return res.status(200).json({ success: true, data: requests });
  } catch (error) {
    console.error("[requests] GET error:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve requests." });
  }
});

// GET /api/abx/requests/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const request = null; // TODO: await CallbackRequestService.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: `No request found with ID: ${id}` });
    }
    return res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error("[requests] GET /:id error:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve request." });
  }
});

// DELETE /api/abx/requests/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = false; // TODO: await CallbackRequestService.deleteById(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: `No request found with ID: ${id}` });
    }
    return res.status(200).json({ success: true, message: `Request ${id} deleted successfully.` });
  } catch (error) {
    console.error("[requests] DELETE /:id error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete request." });
  }
});

export default router;