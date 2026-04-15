require("dotenv").config();

// ----------------------------------------------------------------------------
// Safety net: log unhandled errors before PM2 restart.
// Root cause of previous crash loop (2469 restarts) was ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// inside express-rate-limit; these handlers ensure any future unhandled rejection
// or uncaught exception is at least logged before the process dies.
// ----------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1); // PM2 will restart us
});

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "JWT_SECRET",
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
];

const missingDashboard = DASHBOARD_VARS.filter((v) => !process.env[v]);
if (missingDashboard.length > 0) {
  console.warn("WARNING: Missing dashboard environment variables: " + missingDashboard.join(", "));
  console.warn("Dashboard login will not work until these are configured.");
}

// Express HTTP server
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const app = express();

// Trust first proxy (Nginx/NPM) — avoids express-rate-limit ValidationError
// (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) which caused a PM2 crash loop (2469 restarts).
app.set('trust proxy', 1);

// Security middleware -- applied before all routes
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "https://leadgen.messagingme.app",
  credentials: true,
}));
app.use(express.json({ limit: "50kb" }));

// Auth routes (public -- no middleware)
app.use("/api/auth", require("./api/auth"));

// Tracking endpoints (PUBLIC -- called by email recipients' browsers)
app.use("/track", require("./api/tracking"));

// Auth check (protected)
app.get("/api/auth/check", require("./api/middleware"), (req, res) => {
  res.json({ ok: true });
});

// Dashboard API routes (protected -- authMiddleware applied inside router)
const dashboardRouter = require("./api/dashboard");
app.use("/api/dashboard", dashboardRouter);

// Leads API routes (protected -- authMiddleware applied inside router)
app.use("/api/leads", require("./api/leads"));

// Settings API routes (protected -- authMiddleware applied inside router)
app.use("/api/settings", require("./api/settings"));

// Cold Outbound API routes (protected -- authMiddleware applied inside router)
app.use("/api/cold-outbound", require("./api/cold-outbound"));

// Agent API routes (protected -- static bearer token OPENCLAW_AGENT_TOKEN, read-only)
app.use("/api/agent", require("./api/agent"));

// Cold Outreach API routes (protected -- authMiddleware applied inside router)
app.use("/api/cold-outreach", require("./api/cold-outreach"));

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
