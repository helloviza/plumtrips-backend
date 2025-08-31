// src/routes/oauth.ts
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import { issueSession } from "../utils/session.js";
import User from "../models/user.model.js";
const router = Router();
/* ------------------------------------------------------------------ */
/*  ENVIRONMENT VARS                                                  */
/* ------------------------------------------------------------------ */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = process.env.PORT || 8080;
// Public URL for backend (fallback if redirect not set explicitly)
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;
// Prefer GOOGLE_REDIRECT_URI if provided, else build from BACKEND_PUBLIC_URL
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
    `${BACKEND_PUBLIC_URL}/api/oauth/google/callback`;
// Allowed frontend origins
const FRONTEND_LIST = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const FRONTEND_BASE = FRONTEND_LIST[0];
console.log("[OAuth DEBUG] Using REDIRECT_URI =", REDIRECT_URI);
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
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const fromB64url = (s) => {
    try {
        return Buffer.from(s, "base64url").toString("utf8");
    }
    catch {
        return "/";
    }
};
const safePath = (p) => (!p || !p.startsWith("/") ? "/" : p);
/* ------------------------------------------------------------------ */
/*  STEP 1: SEND USER TO GOOGLE                                       */
/* ------------------------------------------------------------------ */
router.get("/google/start", (req, res) => {
    const from = safePath(String(req.query.from || "/"));
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
        redirect_uri: REDIRECT_URI, // must match console
    });
    console.log("[OAuth DEBUG] Redirecting to:", url);
    res.redirect(url);
});
/* ------------------------------------------------------------------ */
/*  STEP 2: GOOGLE CALLBACK                                           */
/* ------------------------------------------------------------------ */
router.get("/google/callback", async (req, res) => {
    try {
        const { code, state } = req.query;
        if (!code || !state)
            return res.status(400).send("Missing code/state");
        const cookieState = req.cookies?.oauth_state;
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
            const uRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (!uRes.ok) {
                const txt = await uRes.text();
                console.error("[google userinfo failed]", txt);
                return res.status(500).send("OAuth failed (userinfo)");
            }
            const u = (await uRes.json());
            email = (u.email || "").toLowerCase();
            fullName = u.name || fullName || email;
        }
        if (!email)
            return res.status(400).send("Email not available from Google");
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
        }
        else if (fullName && !user.fullName) {
            user.fullName = fullName;
            await user.save();
        }
        // 4) Issue session cookie
        issueSession(res, {
            _id: user._id,
            email: user.email,
            name: user.fullName || undefined,
        });
        // 5) Redirect back to FE
        const dest = new URL(from, FRONTEND_BASE).toString();
        return res.redirect(dest);
    }
    catch (e) {
        const googleErr = e?.response?.data?.error ||
            e?.response?.data?.error_description ||
            e?.message;
        console.error("[google-oauth] callback error:", googleErr || e);
        const msg = process.env.NODE_ENV === "production"
            ? "OAuth failed"
            : `OAuth failed: ${googleErr || "unknown error"}`;
        return res.status(500).send(msg);
    }
});
export default router;
