import { describe, expect, it } from "vitest";
import { escapeHtml, escapeJsonForScriptTag } from "../../src/reporting/html/escape.js";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quoted'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("normal-file_name.jpg")).toBe("normal-file_name.jpg");
  });
});

describe("escapeJsonForScriptTag", () => {
  it("neutralises a </script> breakout attempt inside a JSON string value", () => {
    const maliciousPath = "</script><script>alert(1)</script>.jpg";
    const json = JSON.stringify({ path: maliciousPath });

    const escaped = escapeJsonForScriptTag(json);

    expect(escaped).not.toContain("</script");
    expect(escaped).not.toContain("<script>alert");

    // Still valid, semantically identical JSON once parsed.
    const parsed = JSON.parse(escaped) as { path: string };
    expect(parsed.path).toBe(maliciousPath);
  });

  it("is a no-op for JSON with no '<' characters", () => {
    const json = JSON.stringify({ path: "normal.jpg", count: 3 });
    expect(escapeJsonForScriptTag(json)).toBe(json);
  });
});
