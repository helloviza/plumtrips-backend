import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET: Secret = process.env.JWT_SECRET ?? "dev-secret";
const JWT_EXPIRES: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES as any) ?? "7d";
const COOKIE_NAME = process.env.COOKIE_NAME || "pt_auth";

export type JwtPayload = { id: string; email: string; fullName?: string };

export function issueJwt(payload: JwtPayload) {
  // TS now sees (payload, secret: Secret, options: SignOptions)
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true in production behind HTTPS/CloudFront
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getTokenFromReq(req: Request): string | null {
  const cookie = (req as any).cookies?.[COOKIE_NAME];
  return cookie || null;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  (req as any).user = payload;
  next();
}
