import jwt from "jsonwebtoken";
function pickToken(req) {
    const fromCookies = req.cookies?.token ||
        req.cookies?.authToken ||
        req.cookies?.pt_auth ||
        null;
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const fromHeader = bearer && bearer.toLowerCase() !== "null" && bearer.toLowerCase() !== "undefined"
        ? bearer
        : null;
    const xAuth = req.headers["x-auth-token"]?.trim() || null;
    return fromCookies || fromHeader || xAuth;
}
function extractUserId(payload) {
    return ((payload?.id && String(payload.id)) ||
        (payload?.sub && String(payload.sub)) ||
        (payload?.userId && String(payload.userId)) ||
        (payload?.uid && String(payload.uid)) ||
        undefined);
}
export default function requireUser(req, res, next) {
    const raw = pickToken(req);
    if (!raw) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="user"');
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    const secret = process.env.JWT_SECRET;
    const pubKey = process.env.SSO_PUBLIC_KEY?.replace(/\\n/g, "\n");
    let payload = null;
    // Try HS256 (session cookie) first
    if (secret) {
        try {
            payload = jwt.verify(raw, secret, { algorithms: ["HS256"] });
        }
        catch {
            payload = null;
        }
    }
    // If that failed, optionally try RS256 with the configured public key
    if (!payload && pubKey) {
        try {
            payload = jwt.verify(raw, pubKey, { algorithms: ["RS256"] });
        }
        catch {
            payload = null;
        }
    }
    if (!payload || typeof payload !== "object") {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    const uid = extractUserId(payload);
    if (!uid) {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    req.userId = uid;
    if (payload.sid)
        req.sessionId = String(payload.sid);
    return next();
}
