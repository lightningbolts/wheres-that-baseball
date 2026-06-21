import {
  rebuildPlayByPlayFromFeed,
  gameEventShowsSituation,
} from "../lib/mlb/liveFeed";

async function main() {
  const res = await fetch("https://statsapi.mlb.com/api/v1.1/game/823123/feed/live");
  const feed = await res.json();
  const state = rebuildPlayByPlayFromFeed(
    feed.liveData.plays.allPlays,
    feed.liveData.plays.currentPlay,
  );

  function dump(inning: number, half: string) {
    console.log(`\n=== ${inning} ${half} ===`);
    for (const e of state.entries) {
      if (e.inning !== inning || e.halfInning !== half) continue;
      const before = [
        e.situationBefore.onFirst && "1st",
        e.situationBefore.onSecond && "2nd",
        e.situationBefore.onThird && "3rd",
      ]
        .filter(Boolean)
        .join(",") || "empty";
      const after = [
        e.onFirst && "1st",
        e.onSecond && "2nd",
        e.onThird && "3rd",
      ]
        .filter(Boolean)
        .join(",") || "empty";
      const kind = e.isAtBat === false ? "EVT" : "AB ";
      const show = e.isAtBat === false ? gameEventShowsSituation(e) : true;
      console.log(
        kind,
        show ? "SHOW" : "    ",
        "| outs",
        e.situationBefore.outs,
        "->",
        e.outs,
        "| bases",
        before,
        "->",
        after,
        "|",
        e.isAtBat === false ? e.description.slice(0, 45) : `${e.batterName} ${e.event}`,
      );
    }
  }

  dump(1, "top");
  dump(2, "bottom");
  dump(5, "bottom");
}

void main();
