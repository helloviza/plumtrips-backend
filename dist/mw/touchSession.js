import Session from "../models/session.model.js";
export default async function touchSession(req, _res, next) {
    if (req.sessionId) {
        await Session.updateOne({ _id: req.sessionId }, { $set: { lastSeenAt: new Date() } });
    }
    next();
}
