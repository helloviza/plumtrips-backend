// apps/backend/src/server.ts
import "dotenv/config";
import express from "express";
import cors, { type CorsOptions } from "cors";
import morgan from "morgan";
import http from "http";
import helmet from "helmet";
import cookieParser from "cookie-parser";

// Routers
import oauthRoutes from "./routes/oauth.js";
import meRouter from "./routes/me.js";
import flightsRouter from "./routes/hotels/index.js"; // NOTE: swapped? verify below
import hotelsRouter from "./routes/flights/index.js"; // NOTE: swapped? verify below
import ssoRoutes from "./routes/sso.js";
import authRoutes from "./routes/auth.js";
import bridgeRoutes from "./routes/bridge.js"; // ⬅️ NEW: serves /bridge and /logout-bridge

// Mongo
import { connectMongo } from "./db/mongo.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || "development";

// ---------- Origins / URLs ----------
const FRONTEND_LIST = String(process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const BACKEND_PUBLIC_URL =
  process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;

// ---------- Timeouts ----------
const REQ_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 180_000);
const HDR_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS || 60_000);
const KA_TIMEOUT_MS = Number(process.env.KEEPALIVE_TIMEOUT_MS || 60_000);
const SOCK_TIMEOUT_MS = Number(process.env.SOCKET_TIMEOUT_MS || 180_000);

app.set("trust proxy", 1);
app.set("etag", false);

// ---------- Security + CORS ----------
const corsOpts: CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/health and mobile WebView w/ no Origin
    if (FRONTEND_LIST.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Auth-Token"],
};

app.use(cors(corsOpts));
app.options("*", cors(corsOpts));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cookieParser());

if (NODE_ENV !== "production") app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- Global timeouts ----------
app.use((req, res, next) => {
  req.setTimeout(REQ_TIMEOUT_MS);
  res.setTimeout(REQ_TIMEOUT_MS);
  next();
});

// ---------- Health / misc ----------
app.get("/", (_req, res) => {
  res.type("text/plain").send("✅ PlumTrips backend is running");
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    time: new Date().toISOString(),
    frontendAllowed: FRONTEND_LIST,
    publicUrl: BACKEND_PUBLIC_URL,
  });
});

app.get("/api/v1/_probe", (_req, res) =>
  res.json({ ok: true, where: "server.ts probe" })
);
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// ---------- Effective OAuth redirect (for sanity check) ----------
const effectiveGoogleRedirect = `${BACKEND_PUBLIC_URL}/api/oauth/google/callback`;
console.log("[oauth] GOOGLE_REDIRECT_URI =", effectiveGoogleRedirect);

// ---------- Routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/v1/me", meRouter);

// ⚠️ Double-check these two lines weren’t accidentally swapped in your codebase.
// If your original had flights at /api/v1/flights and hotels at /api/v1/hotels,
// set them like below. (Your earlier snippet showed the correct order.)
app.use("/api/v1/flights", flightsRouter);
app.use("/api/v1/hotels", hotelsRouter);

app.use("/api/v1/sso", ssoRoutes);

// ⬇️ NEW: Mount the HTML bridge endpoints at the ROOT (not under /api)
// This provides:  GET /bridge         (posts {type:'me', payload} to RN WebView)
//                  GET /logout-bridge  (clears cookie & posts {type:'logged_out'})

app.use(bridgeRoutes);

// 404 fallback for unknown API routes
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ ok: false, message: "Not found", path: req.path });
  }
  next();
});

// ---------- Error handler ----------
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[unhandled]", err);
    res
      .status(err?.status || 500)
      .json({ ok: false, message: err?.message || "Internal error" });
  }
);

// ---------- Bootstrap ----------
async function start() {
  const mask = (s?: string) => (s ? s.slice(0, 2) + "****" : "(missing)");

  try {
    const mongoUri = process.env.MONGODB_URI!;
    await connectMongo(mongoUri);
    console.log("✅ MongoDB connected");

    const server: http.Server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[backend] listening on 0.0.0.0:${PORT}`);
      console.log("[env] NODE_ENV =", NODE_ENV);
      console.log("[env] FRONTEND_ORIGIN =", FRONTEND_LIST.join(", "));
      console.log("[env] BACKEND_PUBLIC_URL =", BACKEND_PUBLIC_URL);
      console.log(
        "[env] TBO client=%s user=%s flightBase=%s sharedBase=%s",
        mask(process.env.TBO_ClientId),
        mask(process.env.TBO_UserName),
        process.env.TBO_FLIGHT_BASE_URL || "(missing)",
        process.env.TBO_SHARED_BASE_URL || "(missing)"
      );
    });

    // Node HTTP server timeouts
    (server as any).setTimeout?.(SOCK_TIMEOUT_MS);
    (server as any).requestTimeout = REQ_TIMEOUT_MS;
    (server as any).headersTimeout = HDR_TIMEOUT_MS;
    (server as any).keepAliveTimeout = KA_TIMEOUT_MS;

    // Graceful shutdown
    const shutdown = () => {
      console.log("Shutting down gracefully…");
      server.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 10_000).unref();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (e) {
    console.error("❌ Failed to start server:", e);
    process.exit(1);
  }
}

start();
