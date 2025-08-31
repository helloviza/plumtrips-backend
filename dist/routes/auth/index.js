import { Router } from "express";
import { authenticate, getEndUserIp } from "../../services/tbo/auth.service.js";
const router = Router();
// GET /api/tbo/authenticate  -> { ok, tokenId, endUserIp }
router.get("/", async (_req, res) => {
    try {
        const tokenId = await authenticate();
        res.json({ ok: true, tokenId, endUserIp: getEndUserIp() });
    }
    catch (e) {
        res.status(500).json({ ok: false, message: e.message || "Auth error" });
    }
});
export default router;
