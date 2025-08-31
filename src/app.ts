import express from "express";
import authRoute from "./routes/auth.js";

const app = express();
app.use(express.json());
app.use("/api/tbo/authenticate", authRoute);
app.get("/api/health", (_req, res) => res.json({ ok: true }));

export default app;
