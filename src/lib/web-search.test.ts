import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeSearchResults, searchWeb } from "./web-search";

test("search result parsing rejects unsafe URL schemes and caps results", () => {
  const parsed = sanitizeSearchResults({ web: { results: [
    { title: "Valid", url: "https://example.com/article", description: "A useful summary." },
    { title: "Unsafe", url: "javascript:alert(1)", description: "Ignore this URL." },
    ...Array.from({ length: 7 }, (_, index) => ({ title: `Result ${index}`, url: `https://news.example/${index}`, description: "Summary" })),
  ] } });
  assert.equal(parsed.length, 5);
  assert.ok(parsed.every((item) => item.url.startsWith("https://")));
  assert.equal(parsed[0].domain, "example.com");
});

test("search is explicit about missing credentials without calling the network", async () => {
  const previous = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    const result = await searchWeb("latest TypeScript release");
    assert.equal(result.results.length, 0);
    assert.match(result.error || "", /BRAVE_SEARCH_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.BRAVE_SEARCH_API_KEY = previous;
  }
});
