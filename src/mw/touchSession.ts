// apps/backend/src/mw/touchSession.ts
import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./requireUser.js";
import Session from "../models/session.model.js";

export default async function touchSession(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.sessionId) {
    await Session.updateOne({ _id: req.sessionId }, { $set: { lastSeenAt: new Date() } });
  }
  next();
}
