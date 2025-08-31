import type { Response } from "express";
import jwt from "jsonwebtoken";

type MinimalUser = { _id?: any; id?: any; email?: string; name?: string };

/**
 * Issues an app session JWT (HS256 with JWT_SECRET) and sets all expected cookies:
 *  - token (canonical)
 *  - authToken (legacy)
 *  - pt_auth  (legacy)
 *
 * Returns the signed JWT string.
 */
export function issueSession(res: Response, user: MinimalUser, sid?: string): string {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }

  const payload: Record<string, any> = {
    sub: String(user._id ?? user.id),
    email: user.email,
    name: user.name,
  };
  if (sid) payload.sid = sid;

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  // Set canonical + legacy cookie names to match existing clients
  res.cookie("token", token, cookieOpts);
  res.cookie("authToken", token, cookieOpts);
  res.cookie("pt_auth", token, cookieOpts);

  return token;
}
