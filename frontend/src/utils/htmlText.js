/**
 * Helpers to convert between email HTML body and editable plain text.
 * Used by MessagesDraft to let Julien edit emails in a regular textarea
 * while keeping the backend contract (HTML body) unchanged.
 *
 * Strategy:
 * - htmlToText strips tags while preserving visible structure (paragraphs + links).
 * - textToHtml re-wraps paragraphs, auto-linkifies URLs, and escapes special chars.
 *
 * Limitations (acceptable for cold outreach emails):
 * - Tables / images are not preserved (they'd be lost on a text roundtrip).
 * - Inline formatting (bold, italic) is dropped.
 * - Custom inline styles are dropped (e.g. the CTA button becomes a plain link).
 *   If users need to preserve those, they can switch to the "HTML brut" mode.
 */

/**
 * Convert an email HTML body to a plain text representation suitable for a
 * textarea. Preserves paragraph breaks (double newline) and single line breaks.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return "";
  let text = String(html);

  // Normalize <br> variants to newlines.
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // <p>...</p> boundaries become paragraph separators.
  // Handle the cases: </p> followed by <p>, standalone <p>, standalone </p>.
  text = text.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "");
  text = text.replace(/<\/p>/gi, "\n\n");

  // <a href="URL">TEXT</a> — keep the visible text; if the visible text is
  // empty or equals the URL, fall back to the URL so the user still sees it.
  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, url, inner) => {
      const innerText = inner.replace(/<[^>]+>/g, "").trim();
      if (!innerText) return url;
      if (innerText.toLowerCase() === url.toLowerCase()) return url;
      return innerText + " (" + url + ")";
    }
  );

  // Drop any remaining tags (e.g. <strong>, <span>, <div>).
  text = text.replace(/<[^>]+>/g, "");

  // Decode the HTML entities that commonly appear in generated emails.
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse excessive blank lines to a maximum of one blank line between
  // paragraphs, then trim leading/trailing whitespace.
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

/**
 * Convert plain text back to HTML for email sending. Paragraphs are split on
 * blank lines, single line breaks become <br>, and bare http(s) URLs become
 * clickable anchors with the orange accent used across the dashboard.
 *
 * @param {string} text
 * @returns {string}
 */
export function textToHtml(text) {
  if (!text) return "";
  const trimmed = String(text).trim();
  if (!trimmed) return "";

  const escape = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Calendly URLs are the CTA "Programmer un échange" / "Schedule a call" —
  // render them as the same styled button that message-generator.js produces,
  // so the plain-text roundtrip doesn't silently downgrade them to a bare link.
  // Every other URL keeps the subtle orange underlined style.
  const BUTTON_STYLE =
    "display:inline-block;padding:10px 20px;background-color:#4F46E5;" +
    "color:#ffffff;text-decoration:none;border-radius:6px;" +
    "font-size:14px;font-weight:600;";
  const LINK_STYLE = "color:#ff6600;text-decoration:underline";
  const isCta = (url) => /calendly\.com/i.test(url);
  const anchor = (url, label) => {
    const style = isCta(url) ? BUTTON_STYLE : LINK_STYLE;
    return '<a href="' + url + '" style="' + style + '">' + label + "</a>";
  };

  // Match http(s) URLs. Trailing punctuation (.,;:!?)]) is excluded from the
  // match so "see https://foo.com." keeps its period outside the anchor.
  // Note: regex literals are recreated per line below to avoid any shared
  // lastIndex state between iterations.

  const paragraphs = trimmed.split(/\n\s*\n/);

  const html = paragraphs
    .map((para) => {
      const lines = para.split("\n").map((line) => {
        // Per-line regexes (fresh lastIndex) to stay safe under refactors.
        const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}])/g;
        // Support both "foo (https://foo.com)" (roundtrip from htmlToText)
        // and bare URLs typed by the user.
        const TEXT_URL_RE = /([^\s()]+(?:[^\s()]*[^\s()])?)\s*\((https?:\/\/[^\s)]+)\)/g;
        let out = "";
        let cursor = 0;
        // Walk through "TEXT (URL)" matches first so they become a single <a>.
        const matches = [];
        let m;
        while ((m = TEXT_URL_RE.exec(line)) !== null) {
          matches.push({ start: m.index, end: m.index + m[0].length, label: m[1], url: m[2] });
        }
        for (const match of matches) {
          const before = line.slice(cursor, match.start);
          out += escape(before).replace(URL_RE, (url) => anchor(url, url));
          out += anchor(match.url, escape(match.label));
          cursor = match.end;
        }
        const tail = line.slice(cursor);
        out += escape(tail).replace(URL_RE, (url) => anchor(url, url));
        return out;
      });
      return "<p>" + lines.join("<br>") + "</p>";
    })
    .join("");

  return html;
}
