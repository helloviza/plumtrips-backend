import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface MarketingAuthedRequest extends Request {
  marketingAdminId?: string;
}

function getTokenFromReq(req: Request): string | null {
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

export default function requireMarketingAdmin(
  req: MarketingAuthedRequest,
  res: Response,
  next: NextFunction
) {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const payload = verifyAppJwt(token);
  // ← accept _id, id, userId, or sub — whatever your JWT issuer uses
  const id = payload?._id ?? payload?.id ?? payload?.userId ?? payload?.sub;

  if (!id || String(id) === "undefined") {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }

  req.marketingAdminId = String(id);
  next();
}