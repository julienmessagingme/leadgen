require("dotenv").config();

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

if (missing.length > 0) {
  console.error("ERROR: Missing required environment variables: " + missing.join(", "));
  console.error("Please check your .env file. See .env.example for reference.");
  process.exit(1);
}

console.log("Environment validated");

// Check recommended vars (warn only, do not exit)
const RECOMMENDED_VARS = [
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "MESSAGINGME_API_KEY",
  "MESSAGINGME_WORKSPACE_ID",
  "CALENDLY_URL",
  "ANTHROPIC_API_KEY",
];

const missingRecommended = RECOMMENDED_VARS.filter((v) => !process.env[v]);
if (missingRecommended.length > 0) {
  console.warn("WARNING: Missing recommended environment variables: " + missingRecommended.join(", "));
  console.warn("Some outreach tasks may not function until these are configured.");
}

// Check dashboard vars (warn only, do not exit -- scheduler must keep running)
const DASHBOARD_VARS = [
  "DASHBOARD_USER",
  "DASHBOARD_PASSWORD_HASH",
  "JWT_SECRET",
];

const missingDashboard = DASHBOARD_VARS.filter((v) => !process.env[v]);
if (missingDashboard.length > 0) {
  console.warn("WARNING: Missing dashboard environment variables: " + missingDashboard.join(", "));
  console.warn("Dashboard login will not work until these are configured.");
}

// Express HTTP server
const express = require("express");
const path = require("path");
const app = express();

app.use(express.json());

// Auth routes (public -- no middleware)
app.use("/api/auth", require("./api/auth"));

// Auth check (protected)
app.get("/api/auth/check", require("./api/middleware"), (req, res) => {
  res.json({ ok: true });
});

// Dashboard API routes (protected -- authMiddleware applied inside router)
const dashboardRouter = require("./api/dashboard");
app.use("/api/dashboard", dashboardRouter);

// Serve React build
app.use(express.static(path.join(__dirname, "..", "dist")));

// SPA catch-all -- MUST be after all /api routes (Express 5 requires named param)
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

const PORT = process.env.PORT || 3006;
const BIND_HOST = process.env.BIND_HOST || "172.17.0.1";
app.listen(PORT, BIND_HOST, () => {
  console.log(`HTTP server listening on ${BIND_HOST}:${PORT}`);
});

// Load scheduler
try {
  require("./scheduler");
} catch (err) {
  console.error("Failed to load scheduler:", err.message);
  // Don't exit -- Express must keep running even if scheduler fails
}
