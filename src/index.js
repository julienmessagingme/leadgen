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

// Load scheduler
try {
  require("./scheduler");
} catch (err) {
  console.error("Failed to load scheduler:", err.message);
  process.exit(1);
}
