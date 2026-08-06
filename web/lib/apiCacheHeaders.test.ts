import { describe, expect, it } from "vitest";

import { publicApiCacheHeaders, withNetlifyQueryVary } from "@/lib/apiCacheHeaders";

describe("apiCacheHeaders", () => {
  it("adds Netlify-Vary for query-dependent public caches", () => {
    expect(publicApiCacheHeaders(120, ["season", "hitKey"])).toEqual({
      "Cache-Control": "public, max-age=120",
      "Netlify-Vary": "query=season|hitKey",
    });
  });

  it("preserves custom Cache-Control when attaching vary", () => {
    expect(
      withNetlifyQueryVary(
        { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
        ["batterId"],
      ),
    ).toEqual({
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      "Netlify-Vary": "query=batterId",
    });
  });
});
