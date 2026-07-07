import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const gameCacheExcludes = ["./data/nerd-stats/**/games/**"];

const heavyDataExcludes = [
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
    "/**": gameCacheExcludes,
    "/api/cron/sync-schedule": heavyDataExcludes,
    "/api/games/**": heavyDataExcludes,
    "/api/game/**": heavyDataExcludes,
    "/api/gameday/**": heavyDataExcludes,
    "/api/matchup": heavyDataExcludes,
    "/api/predict": heavyDataExcludes,
    "/api/batter/**": heavyDataExcludes,
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
    "/api/ballparks/hits": ["./data/ballpark-hits/**"],
    "/nerd/**": [
      "./data/nerd-stats/**/summary.json",
      "./data/nerd-stats/**/stats/**",
      "./data/nerd-stats/**/teams/**",
    ],
  },
};

export default nextConfig;
