// src/routes/bridge.ts
import { Router, Request, Response } from "express";

const SESSION_COOKIE_NAME = "plum_session"; // ⬅️ change to your real session cookie name

const router = Router();

/** /bridge — fetches /api/me (same-origin, with cookie) and posts back to the mobile app */
router.get("/bridge", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<script>
(async () => {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    const j = await r.json();
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'me', payload: j }));
  } catch (e) {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'me', payload: { ok:false, error:'bridge_failed' } }));
  }
})();
</script>
<body>OK</body>`);
});

/** /logout-bridge — clears session cookie and tells the mobile app */
router.get("/logout-bridge", (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    // domain: "api.plumtrips.com", // uncomment if you set Domain when issuing the cookie
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<script>
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type:'logged_out' }));
</script>
<body>Logged out.</body>`);
});

export default router;
