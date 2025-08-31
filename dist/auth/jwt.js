import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES ?? "7d";
const COOKIE_NAME = process.env.COOKIE_NAME || "pt_auth";
export function issueJwt(payload) {
    // TS now sees (payload, secret: Secret, options: SignOptions)
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
export function setAuthCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false, // set true in production behind HTTPS/CloudFront
        maxAge: 1000 * 60 * 60 * 24 * 7,
        path: "/",
    });
}
export function clearAuthCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
}
export function getTokenFromReq(req) {
    const cookie = req.cookies?.[COOKIE_NAME];
    return cookie || null;
}
export function verifyJwt(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
export function authRequired(req, res, next) {
    const token = getTokenFromReq(req);
    if (!token)
        return res.status(401).json({ error: "Unauthorized" });
    const payload = verifyJwt(token);
    if (!payload)
        return res.status(401).json({ error: "Unauthorized" });
    req.user = payload;
    next();
}
