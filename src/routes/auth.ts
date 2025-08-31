import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import jwt from "jsonwebtoken";
import User, { type IUser, type UserDoc } from "../models/user.model.js";
import { issueSession } from "../utils/index.js"; // barrel import

const router = Router();

const RegisterSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

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

function clearAuthCookies(res: any) {
  const opts = { path: "/" };
  res.clearCookie("token", opts);
  res.clearCookie("authToken", opts);
  res.clearCookie("pt_auth", opts);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const data = RegisterSchema.parse(req.body);

    const exists = await User.findOne({ email: data.email.toLowerCase() }).lean<{ _id: any }>();
    if (exists) return res.status(409).send("Email already registered");

    const passwordHash = await bcrypt.hash(data.password, 10);

    const userDoc: UserDoc = await new User({
      email: data.email.toLowerCase(),
      passwordHash,
      fullName: data.fullName,
      phone: data.phone || undefined,
    }).save();

    // Normalize null -> undefined for name
    issueSession(res, {
      _id: userDoc._id,
      email: userDoc.email,
      name: userDoc.fullName || undefined,
    });

    res.json({
      user: {
        id: String(userDoc._id),
        email: userDoc.email,
        fullName: userDoc.fullName,
        phone: userDoc.phone,
      },
    });
  } catch (err: any) {
    if (err?.issues) return res.status(400).send("Invalid input");
    res.status(500).send("Registration failed");
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const data = LoginSchema.parse(req.body);

    const userDoc = await User.findOne({ email: data.email.toLowerCase() });
    if (!userDoc) return res.status(401).send("Invalid email or password");

    const ok = await bcrypt.compare(data.password, userDoc.passwordHash);
    if (!ok) return res.status(401).send("Invalid email or password");

    // Normalize null -> undefined for name
    issueSession(res, {
      _id: userDoc._id,
      email: userDoc.email,
      name: userDoc.fullName || undefined,
    });

    res.json({
      user: {
        id: String(userDoc._id),
        email: userDoc.email,
        fullName: userDoc.fullName,
        phone: userDoc.phone,
      },
    });
  } catch (err: any) {
    if (err?.issues) return res.status(400).send("Invalid input");
    res.status(500).send("Login failed");
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  const token = getTokenFromReq(req);
  if (!token) return res.json({ user: null });

  const payload = verifyAppJwt(token);
  if (!payload) return res.json({ user: null });

  const uid = String(
    (payload as any).id ??
      (payload as any).sub ??
      (payload as any).userId ??
      (payload as any).uid ??
      ""
  );
  if (!uid) return res.json({ user: null });

  const user = await User.findById(uid)
    .select("email fullName phone")
    .lean<IUser | null>();

  if (!user) return res.json({ user: null });

  res.json({
    user: {
      id: String(user._id),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
    },
  });
});

export default router;
