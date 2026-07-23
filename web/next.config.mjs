import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const gameCacheExcludes = ["./data/nerd-stats/**/games/**"];

const heavyDataExcludes = [
  ...gameCacheExcludes,
  "./data/nerd-stats/**/history/**",
  "./data/ballpark-hits/**",
  "./data/player-bip/**",
];

const nerdStatsIncludes = [
  "./data/nerd-stats/**/summary.json",
  "./data/nerd-stats/**/manifest.json",
  "./data/nerd-stats/**/counters.json",
  "./data/nerd-stats/**/stats/**",
  "./data/nerd-stats/**/teams/**",
  "./data/nerd-stats/**/windows/**",
  "./data/nerd-stats/**/splits/**",
  "./data/nerd-stats/**/history/**",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  outputFileTracingExcludes: {
    "/**": gameCacheExcludes,
    "/api/cron/sync-schedule": heavyDataExcludes,
    "/api/games/**": heavyDataExcludes,
    "/api/game/**": heavyDataExcludes,
    "/api/gameday/**": heavyDataExcludes,
    "/api/matchup": heavyDataExcludes,
    "/api/predict": heavyDataExcludes,
    "/api/batter/**": heavyDataExcludes,
    "/api/ballparks/hits": ["./data/player-bip/**", "./data/nerd-stats/**"],
    "/api/players/**": ["./data/ballpark-hits/**", "./data/nerd-stats/**"],
    "/games/**": heavyDataExcludes,
    "/games": heavyDataExcludes,
    "/live/**": heavyDataExcludes,
    "/": heavyDataExcludes,
    "/ballparks/**": heavyDataExcludes,
    "/ballparks": heavyDataExcludes,
    "/nerd/**": gameCacheExcludes,
  },
  outputFileTracingIncludes: {
    "/api/nerd-stats": nerdStatsIncludes,
    "/api/nerd-stats/**": nerdStatsIncludes,
    // Slimmed season JSON only — keep under Vercel's 250MB uncompressed function limit.
    "/api/ballparks/hits": ["./data/ballpark-hits/**"],
    "/api/players/**": ["./data/player-bip/**"],
    "/nerd/**": [
      "./data/nerd-stats/**/summary.json",
      "./data/nerd-stats/**/stats/**",
      "./data/nerd-stats/**/teams/**",
    ],
  },
};

export default nextConfig;
