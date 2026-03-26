/**
 * Gmail SMTP wrapper using Nodemailer.
 * Lazy-init transporter pattern: does not throw at module load if env vars missing.
 */

const nodemailer = require("nodemailer");

let _transporter = null;

/**
 * Get or create the Nodemailer SMTP transporter.
 * Throws if GMAIL_USER or GMAIL_APP_PASSWORD are not set.
 */
function getTransporter() {
  if (!_transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user) {
      throw new Error("GMAIL_USER is not set in environment");
    }
    if (!pass) {
      throw new Error("GMAIL_APP_PASSWORD is not set in environment");
    }

    _transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return _transporter;
}

/**
 * Send an email via Gmail SMTP.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML body content
 * @param {string|null} textBody - Optional plain text body
 * @returns {Promise<string>} Message ID from SMTP server
 */
async function sendEmail(to, subject, htmlBody, textBody) {
  const transporter = getTransporter();

  const mailOptions = {
    from: '"Julien Dumas - MessagingMe" <' + process.env.GMAIL_USER + '>',
    to,
    subject,
    html: htmlBody,
  };

  if (textBody) {
    mailOptions.text = textBody;
  }

  const info = await transporter.sendMail(mailOptions);
  return info.messageId;
}

module.exports = { sendEmail };
