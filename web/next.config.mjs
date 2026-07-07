import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const gameCacheExcludes = ["./data/nerd-stats/**/games/**"];

const cronDataExcludes = [
  ...gameCacheExcludes,
  "./data/nerd-stats/**/history/**",
  "./data/ballpark-hits/**",
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
    "/api/cron/sync-schedule": cronDataExcludes,
    "/api/games/**": cronDataExcludes,
    "/api/game/**": cronDataExcludes,
    "/api/gameday/**": cronDataExcludes,
    "/api/matchup": cronDataExcludes,
    "/api/predict": cronDataExcludes,
    "/api/batter/**": cronDataExcludes,
    "/api/nerd-stats": gameCacheExcludes,
    "/api/nerd-stats/**": gameCacheExcludes,
    "/nerd/**": gameCacheExcludes,
  },
  outputFileTracingIncludes: {
    "/api/nerd-stats": nerdStatsIncludes,
    "/api/nerd-stats/**": nerdStatsIncludes,
    "/api/ballparks/hits": ["./data/ballpark-hits/**"],
    "/nerd/**": [
      "./data/nerd-stats/**/summary.json",
      "./data/nerd-stats/**/stats/**",
      "./data/nerd-stats/**/teams/**",
    ],
  },
};

export default nextConfig;
