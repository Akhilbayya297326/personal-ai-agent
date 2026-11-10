import type { SearchSource } from "@/lib/db";

export type SearchFreshness = "pd" | "pw" | "pm" | "py";
export type WebSearchOutput = { results: SearchSource[]; error?: string };

const SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeSearchResults(payload: unknown): SearchSource[] {
  if (!payload || typeof payload !== "object") return [];
  const web = (payload as { web?: { results?: unknown } }).web;
  if (!Array.isArray(web?.results)) return [];
  const results: SearchSource[] = [];
  for (const item of web.results) {
    if (!item || typeof item !== "object") continue;
    const record = item as { title?: unknown; url?: unknown; description?: unknown; page_age?: unknown };
    const url = safeHttpUrl(record.url);
    if (!url) continue;
    results.push({
      title: typeof record.title === "string" ? record.title.slice(0, 220) : new URL(url).hostname,
      url,
      domain: new URL(url).hostname.replace(/^www\./, ""),
      snippet: typeof record.description === "string" ? record.description.slice(0, 700) : "",
      ...(typeof record.page_age === "string" ? { publishedAt: record.page_age.slice(0, 80) } : {}),
    });
    if (results.length === 5) break;
  }
  return results;
}

export async function searchWeb(query: string, freshness?: SearchFreshness): Promise<WebSearchOutput> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { results: [], error: "Web search is not configured. Add BRAVE_SEARCH_API_KEY to the local environment." };
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!normalized) return { results: [], error: "Search query is empty." };

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", normalized);
  url.searchParams.set("count", "5");
  url.searchParams.set("country", process.env.BRAVE_SEARCH_COUNTRY || "IN");
  url.searchParams.set("search_lang", process.env.BRAVE_SEARCH_LANGUAGE || "en");
  url.searchParams.set("safesearch", "moderate");
  if (freshness) url.searchParams.set("freshness", freshness);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { results: [], error: "Web search authentication failed. Check BRAVE_SEARCH_API_KEY." };
      if (response.status === 429) return { results: [], error: "Web search is rate-limited. Try again in a moment." };
      return { results: [], error: `Web search provider returned HTTP ${response.status}.` };
    }
    const payload: unknown = await response.json();
    const results = sanitizeSearchResults(payload);
    return results.length ? { results } : { results: [], error: "No web results were returned for that query." };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Web search timed out after seven seconds."
      : "Web search could not connect. Check the network and try again.";
    return { results: [], error: message };
  }
}
