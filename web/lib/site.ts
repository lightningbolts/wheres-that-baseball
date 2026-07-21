export const SITE_NAME = "Where's That Baseball";
export const SITE_NAME_SHORT = "Where's That BB";
export const SITE_DESCRIPTION =
  "Live MLB games, ballpark spray charts, and team stat standings.";

export const DEVELOPER_NAME = "Kairui";
export const DEVELOPER_EMAIL = "timberlake2025@gmail.com";
export const DONATE_URL = "https://buymeacoffee.com/timberlake2025";

/** Canonical site origin for metadata, OG images, and share links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
