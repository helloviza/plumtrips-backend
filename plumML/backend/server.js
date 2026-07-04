const express = require("express");
const cors = require("cors");
const path = require("path");
const config = require("./config/config");
const itineraryRoutes = require("./routes/itinerary");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve generated PDFs
app.use("/generated", express.static(path.join(__dirname, "public", "generated")));

app.use("/api", itineraryRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`Plumtrips AI Planner backend running on http://localhost:${config.port}`);
});
