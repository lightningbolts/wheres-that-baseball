/**
 * Cache headers for Netlify + browsers.
 *
 * Netlify's CDN does not include query strings in the cache key by default.
 * API routes that branch on searchParams must send `Netlify-Vary: query=...`
 * or clients get the wrong cached body (e.g. list payload for a hitKey request).
 */
export function publicApiCacheHeaders(
  maxAgeSeconds: number,
  varyQueryKeys: string[],
): Record<string, string> {
  return withNetlifyQueryVary(
    { "Cache-Control": `public, max-age=${maxAgeSeconds}` },
    varyQueryKeys,
  );
}

/** Attach Netlify query-string cache variation to existing response headers. */
export function withNetlifyQueryVary(
  headers: Record<string, string>,
  varyQueryKeys: string[],
): Record<string, string> {
  const keys = varyQueryKeys.filter(Boolean);
  if (keys.length === 0) return headers;
  return {
    ...headers,
    "Netlify-Vary": `query=${keys.join("|")}`,
  };
}
