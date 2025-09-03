// src/routes/bridge.ts
import { Router } from "express";

const router = Router();

router.get("/bridge", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Bridge</title></head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
    <p>Connecting…</p>
    <script>
      (async function () {
        try {
          const r = await fetch('/api/v1/me', { credentials: 'include' });
          const j = await r.json();
          const msg = j && j.ok
            ? { type: 'me', payload: { ok: true, user: j.user } }
            : { type: 'me', payload: { ok: false, error: (j && j.message) || 'no_session' } };
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg));
        } catch (e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'me', payload: { ok:false, error: 'bridge_fetch_failed' } }));
        }
      })();
    </script>
  </body>
</html>`);
});

router.get("/logout-bridge", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Logout</title></head>
  <body><p>Logging out…</p>
    <script>
      (async function () {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'logged_out' }));
      })();
    </script>
  </body>
</html>`);
});

export default router;
