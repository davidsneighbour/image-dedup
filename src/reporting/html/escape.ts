/**
 * HTML/script-context escaping for the static report (PLAN.md §31:
 * "escape all report content"). File paths and other strings embedded in
 * the report ultimately come from filenames on disk — untrusted input
 * (PLAN.md §31: "Treat image files as untrusted input") — so nothing
 * derived from a scanned file may be interpolated into HTML unescaped.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LESS_THAN_UNICODE_ESCAPE = "\\u003c";

/**
 * Makes a JSON string safe to embed as the literal text content of a
 * `<script type="application/json">` element. HTML's raw-text parsing
 * rules for `<script>` only look for the literal byte sequence
 * `</script` (case-insensitively) to end the element — a JSON string
 * value happening to contain that sequence (e.g. a maliciously named
 * source file) would otherwise prematurely close the tag and let
 * following bytes be parsed as a sibling `<script>`. Replacing every
 * less-than sign with its unicode JSON escape removes the only
 * character that sequence depends on, while remaining valid,
 * semantically identical JSON (`JSON.parse` reverses `\uXXXX` escapes
 * normally).
 */
export function escapeJsonForScriptTag(json: string): string {
  return json.replace(/</g, LESS_THAN_UNICODE_ESCAPE);
}
