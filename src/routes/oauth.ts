// src/routes/oauth.ts
import { Router, type Request, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import { issueSession } from "../utils/session.js";
import User from "../models/user.model.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  ENVIRONMENT VARS                                                  */
/* ------------------------------------------------------------------ */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const PORT = process.env.PORT || 8080;

// Public URL for backend (fallback if redirect not set explicitly)
const BACKEND_PUBLIC_URL =
  process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;

// Prefer GOOGLE_REDIRECT_URI if provided, else build from BACKEND_PUBLIC_URL
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${BACKEND_PUBLIC_URL}/api/oauth/google/callback`;

// Allowed frontend origins (first one used as base)
const FRONTEND_LIST = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FRONTEND_BASE = FRONTEND_LIST[0];

console.log("[OAuth] REDIRECT_URI        =", REDIRECT_URI);
console.log("[OAuth] BACKEND_PUBLIC_URL  =", BACKEND_PUBLIC_URL);
console.log("[OAuth] FRONTEND_BASE       =", FRONTEND_BASE);

/* ------------------------------------------------------------------ */
/*  GOOGLE CLIENT                                                     */
/* ------------------------------------------------------------------ */
const oauth2 = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
});

/* ------------------------------------------------------------------ */
/*  HELPERS                                                           */
/* ------------------------------------------------------------------ */
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const fromB64url = (s: string) => {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return "/";
  }
};
const safePath = (p?: string) => (!p || !p.startsWith("/") ? "/" : p);

/** Mobile sentinel: if `from` equals this, we end at /bridge */
const MOBILE_SENTINEL = "/__mobile_bridge__";

/* ------------------------------------------------------------------ */
/*  OPTIONAL: legacy alias                                            */
/*  Hitting /api/oauth/google will just forward to /start              */
/* ------------------------------------------------------------------ */
router.get("/google", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  // absolute path to survive router mounting path
  return res.redirect(302, `/api/oauth/google/start${qs}`);
});

/* ------------------------------------------------------------------ */
/*  STEP 1: SEND USER TO GOOGLE                                       */
/*      GET /api/oauth/google/start?from=/account                     */
/*      Mobile app should pass from=/__mobile_bridge__                */
/*      (or you can set ?mobile=1 to force the sentinel)              */
/* ------------------------------------------------------------------ */
router.get("/google/start", (req: Request, res: Response) => {
  // Prefer explicit ?from=... otherwise "/" (or sentinel if ?mobile=1)
  let from = safePath(String(req.query.from || "/"));
  const mobile = String(req.query.mobile || "") === "1";
  if (mobile) from = MOBILE_SENTINEL;

  const nonce = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60 * 1000, // 10 mins
  });

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "profile"],
    state: `${nonce}.${b64url(from)}`,
    redirect_uri: REDIRECT_URI, // must match Google Console
  });

  console.log("[OAuth] redirecting user to Google Auth");
  res.redirect(url);
});

/* ------------------------------------------------------------------ */
/*  STEP 2: GOOGLE CALLBACK                                           */
/*      GET /api/oauth/google/callback?code=...&state=...             */
/* ------------------------------------------------------------------ */
router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return res.status(400).send("Missing code/state");

    const cookieState = (req as any).cookies?.oauth_state;
    const [nonce, b64from] = state.split(".", 2);

    if (!cookieState || !nonce || cookieState !== nonce) {
      return res.status(400).send("Invalid state");
    }
    res.clearCookie("oauth_state", { path: "/" });

    const from = safePath(fromB64url(b64from));

    // 1) Exchange code -> tokens
    const { tokens } = await oauth2.getToken({ code, redirect_uri: REDIRECT_URI });
    oauth2.setCredentials(tokens);

    // 2) Extract user info
    let email = "";
    let fullName = "";

    if (tokens.id_token) {
      const ticket = await oauth2.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = (payload?.email || "").toLowerCase();
      fullName = payload?.name || "";
    }

    if (!email) {
      // fallback to userinfo if needed
      const uRes: any = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!uRes.ok) {
        const txt = await uRes.text();
        console.error("[OAuth] userinfo failed:", txt);
        return res.status(500).send("OAuth failed (userinfo)");
      }
      const u = (await uRes.json()) as any;
      email = (u.email || "").toLowerCase();
      fullName = u.name || fullName || email;
    }

    if (!email) return res.status(400).send("Email not available from Google");

    // 3) Upsert user
    let user = await User.findOne({ email });
    if (!user) {
      user = await new User({
        email,
        passwordHash: crypto.randomBytes(32).toString("hex"), // dummy
        fullName,
        emailVerifiedAt: new Date(),
        roles: ["user"],
      }).save();
    } else if (fullName && !user.fullName) {
      user.fullName = fullName;
      await user.save();
    }

    // 4) Issue session cookie (HttpOnly, Secure, SameSite=None inside issueSession)
    issueSession(res, {
      _id: user._id,
      email: user.email,
      name: user.fullName || undefined,
    });

    // 5) Redirect destination
    const isMobile = from === MOBILE_SENTINEL || from === "/bridge";
    if (isMobile) {
      // ✅ Mobile: land on /bridge so Expo Custom Tab hits returnUrl and closes
      const bridgeUrl = `${BACKEND_PUBLIC_URL}/bridge`;
      return res.redirect(302, bridgeUrl);
    }

    // ✅ Web: send users back to your website (respect original "from")
    const dest = new URL(from || "/account", FRONTEND_BASE).toString();
    return res.redirect(302, dest);
  } catch (e: any) {
    const googleErr =
      e?.response?.data?.error ||
      e?.response?.data?.error_description ||
      e?.message;

    console.error("[OAuth] callback error:", googleErr || e);

    const msg =
      process.env.NODE_ENV === "production"
        ? "OAuth failed"
        : `OAuth failed: ${googleErr || "unknown error"}`;

    return res.status(500).send(msg);
  }
});

export default router;
