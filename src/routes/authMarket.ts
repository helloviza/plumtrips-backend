console.log("🔥 authMarket router initialized");


import { Router } from 'express';
import { z } from 'zod';
import { issueSession } from '../utils/index.js'; // barrel import
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {MarketingAdmin} from '../models/marketing.model.js';
const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

function clearAuthCookies(res: any) {
  const opts = { path: "/" };
  res.clearCookie("token", opts);
  res.clearCookie("authToken", opts);
  res.clearCookie("pt_auth", opts);
}
/** Helpers for /me + logout */
function getTokenFromReq(req: any): string | null {
  const bearer =
    req.headers?.authorization?.replace(/^Bearer\s+/i, "").trim() || "";
  const fromHeader =
    bearer && bearer.toLowerCase() !== "null" && bearer.toLowerCase() !== "undefined"
      ? bearer
      : null;

  return (
    req.cookies?.token ||
    req.cookies?.authToken ||
    req.cookies?.pt_auth ||
    fromHeader ||
    null
  );
}

function verifyAppJwt(token: string): any | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!);
  } catch {
    return null;
  }
}


router.post('/marketingLogin', async (req, res) => {
    try {
        const { email, password } = LoginSchema.parse(req.body);

        const admin = await MarketingAdmin.findOne({ email });
        if (!admin) {
            return res.status(401).json({ message: 'User Not Found' });
        }   

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
        issueSession(res, {id: String (admin._id), email: admin.email});

        res.json({
        ok: true,
        user: {
        email: admin.email,
         _id: admin._id
        }
});
    } catch (e: any) {
        res.status(400).json({ message: e.message || 'Login failed' });
    }
});

router.post("/marketingLogout", (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});


router.get("/me", async (req, res) => {
  const token = getTokenFromReq(req);
  if (!token) return res.json({ user: null });

  const payload = verifyAppJwt(token);
  if (!payload?.id || payload.id === "undefined") return res.json({ user: null });

  const admin = await MarketingAdmin.findById(payload.id)
    .select("email")
    .lean();

  if (!admin) return res.json({ user: null });

  res.json({
    user: {
      _id: String(admin._id),
      email: admin.email,
    },
  });
});

export default router;

