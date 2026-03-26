const crypto = require("crypto");
const { supabase } = require("./supabase");

/**
 * Hash a value using SHA256 for RGPD suppression list comparison.
 * Input is lowercased and trimmed before hashing.
 *
 * @param {string} value - Value to hash (email, phone, LinkedIn URL)
 * @returns {string} 64-char hex SHA256 digest
 */
function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(value.toLowerCase().trim())
    .digest("hex");
}

/**
 * Check if a contact is on the RGPD suppression list.
 * Fail-safe: returns true (suppressed) if the check fails.
 *
 * @param {string|null} email - Email to check
 * @param {string|null} linkedinUrl - LinkedIn URL to check
 * @param {string|null} phone - Phone number to check
 * @returns {Promise<boolean>} true if contact is suppressed (or check failed)
 */
async function isSuppressed(email = null, linkedinUrl = null, phone = null) {
  try {
    const hashes = [];

    if (email) hashes.push(hashValue(email));
    if (linkedinUrl) hashes.push(hashValue(linkedinUrl));
    if (phone) hashes.push(hashValue(phone));

    if (hashes.length === 0) {
      return false;
    }

    const { data, error } = await supabase
      .from("suppression_list")
      .select("id")
      .in("hashed_value", hashes)
      .limit(1);

    if (error) {
      console.error("Suppression check failed:", error.message);
      return true; // fail-safe: treat as suppressed
    }

    return data.length > 0;
  } catch (err) {
    console.error("Suppression check failed:", err.message);
    return true; // fail-safe: treat as suppressed
  }
}

module.exports = { isSuppressed, hashValue };
