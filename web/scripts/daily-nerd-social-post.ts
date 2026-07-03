import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import {
  buildDailySocialPostCopy,
  dailyCategoryLabel,
  pickDailyNerdStatId,
  PRIMARY_VIRAL_HABIT,
} from "@/lib/mlb/nerdStats/socialHabit";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";
import { getSiteUrl } from "@/lib/site";

const season = new Date().getFullYear();
const statId = pickDailyNerdStatId(season);
const detail = loadNerdStatDetail(season, statId);
const definition = getNerdStatDefinition(statId);
const siteUrl = getSiteUrl();

if (!detail || !definition) {
  console.error("Daily nerd stat data not found for", statId);
  process.exit(1);
}

const pilotStart = new Date();
const pilotEnd = new Date(pilotStart);
pilotEnd.setDate(pilotEnd.getDate() + 13);

console.log("=== Where's That Baseball · Daily Nerd Post ===");
console.log(`Habit: ${PRIMARY_VIRAL_HABIT}`);
console.log(`Date: ${new Date().toISOString().slice(0, 10)}`);
console.log(`Category: ${dailyCategoryLabel()}`);
console.log(`Stat: ${definition.title} (${statId})`);
console.log(`Daily URL: ${siteUrl}/nerd/daily`);
console.log(`Stat URL: ${siteUrl}/nerd/${statId}`);
console.log(`Share card: ${siteUrl}/api/nerd-stats/share-card?statId=${statId}&season=${season}`);
console.log("");
console.log("--- Suggested post copy ---");
console.log(buildDailySocialPostCopy(detail, statId));
console.log("");
console.log("--- 2-week organic pilot ---");
console.log(`Post daily at 9:00 AM ET through ${pilotEnd.toISOString().slice(0, 10)}`);
console.log("Download the share card from the stat page or share-card URL above.");
console.log("API: GET /api/nerd-stats/daily");
