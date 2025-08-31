// src/routes/sso.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import requireUser, { AuthedRequest } from "../mw/requireUser.js";
import SsoTicket from "../models/ssoTicket.model.js";   // ✅ use your model

const r = Router();

/** ---- ENV / CONFIG ---- */
const BACKEND_PUBLIC_URL =
  process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`;

const SSO_PRIVATE_KEY = (process.env.SSO_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const SSO_PUBLIC_KEY = (process.env.SSO_PUBLIC_KEY || "").replace(/\\n/g, "\n");

const SSO_REDEEM_API_KEY = process.env.SSO_REDEEM_API_KEY || "";
const HZ_BASE = process.env.SSO_HELLOVIZA_BASE_URL || "http://localhost:5055";
const SSO_AUDIENCE = "helloviza";
const TICKET_TTL_SEC = Number(process.env.SSO_TICKET_TTL || 120); // default 2 min

/* ------------------------------------------------------------------ */
/*  DEBUG                                                             */
/* ------------------------------------------------------------------ */
r.get("/_debug", (_req, res) => {
  res.json({
    ok: true,
    backendPublicUrl: BACKEND_PUBLIC_URL,
    havePrivate: !!SSO_PRIVATE_KEY,
    havePublic: !!SSO_PUBLIC_KEY,
    haveRedeemKey: !!SSO_REDEEM_API_KEY,
    audience: SSO_AUDIENCE,
  });
});

/* ------------------------------------------------------------------ */
/*  ISSUE TICKET                                                      */
/* ------------------------------------------------------------------ */
r.post("/ticket", requireUser, async (req: AuthedRequest, res) => {
  try {
    if (!SSO_PRIVATE_KEY) {
      return res.status(500).json({ ok: false, message: "SSO private key missing" });
    }

    const aud = String(req.body?.aud || "");
    if (aud !== SSO_AUDIENCE) {
      return res.status(400).json({ ok: false, message: "Invalid audience" });
    }

    const ret = typeof req.body?.return === "string" ? req.body.return : "/";
    const jti = crypto.randomUUID();

    // Sign RS256 JWT ticket
    const ticket = jwt.sign(
      {},
      SSO_PRIVATE_KEY,
      {
        algorithm: "RS256",
        audience: SSO_AUDIENCE,
        issuer: BACKEND_PUBLIC_URL,
        subject: String(req.userId),
        expiresIn: TICKET_TTL_SEC,
        jwtid: jti,
      }
    );

    // Persist in DB
    await SsoTicket.create({
      jti,
      aud,
      userId: req.userId,
      expAt: new Date(Date.now() + TICKET_TTL_SEC * 1000),
    });

    const redirectUrl =
      `${HZ_BASE}/sso/consume?ticket=${encodeURIComponent(ticket)}&ret=${encodeURIComponent(ret)}`;

    res.json({ ok: true, redirectUrl });
  } catch (e: any) {
    console.error("[sso/ticket] error:", e?.message || e);
    res.status(500).json({ ok: false, message: "Ticket error" });
  }
});

/* ------------------------------------------------------------------ */
/*  REDEEM TICKET                                                     */
/* ------------------------------------------------------------------ */
r.post("/redeem", async (req, res) => {
  try {
    if (!SSO_PUBLIC_KEY) {
      return res.status(500).json({ ok: false, message: "SSO public key missing" });
    }
    if (!SSO_REDEEM_API_KEY) {
      return res.status(500).json({ ok: false, message: "Redeem key not set" });
    }

    const provided = String(req.headers["x-sso-key"] || "");
    if (provided !== SSO_REDEEM_API_KEY) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const ticket = String(req.body?.ticket || "");
    if (!ticket) return res.status(400).json({ ok: false, message: "Missing ticket" });

    // Verify RS256 ticket
    const decoded = jwt.verify(ticket, SSO_PUBLIC_KEY, {
      algorithms: ["RS256"],
      issuer: BACKEND_PUBLIC_URL,
      audience: SSO_AUDIENCE,
    }) as jwt.JwtPayload;

    const userId = String(decoded.sub || "");
    const jti = String(decoded.jti || "");
    if (!userId || !jti) {
      return res.status(400).json({ ok: false, message: "Invalid ticket payload" });
    }

    // Check DB record (single-use guard)
    const record = await SsoTicket.findOne({ jti, aud: SSO_AUDIENCE, userId });
    if (!record) {
      return res.status(400).json({ ok: false, message: "Ticket not found" });
    }
    if (record.usedAt) {
      return res.status(400).json({ ok: false, message: "Ticket already used" });
    }
    if (record.expAt.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: "Ticket expired" });
    }

    // Mark used
    record.usedAt = new Date();
    await record.save();

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ ok: false, message: "JWT_SECRET missing" });
    }

    // Issue HS256 token for HV
    const appToken = jwt.sign(
      { sub: userId },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "30d" }
    );

    res.json({ ok: true, token: appToken });
  } catch (e: any) {
    console.error("[sso/redeem] error:", e?.message || e);
    res.status(401).json({ ok: false, message: "Redeem failed" });
  }
});

export default r;
