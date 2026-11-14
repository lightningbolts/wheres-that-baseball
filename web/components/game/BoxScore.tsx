"use client";

import type { BaseballGame } from "@/lib/game/rules/game";
import { getTeamById } from "@/lib/mlb/teams";

const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

export function BoxScore({ game, awayId, homeId }: { game: BaseballGame; awayId: number; homeId: number }) {
  const innings = Math.max(game.regulation, game.line.away.length, game.line.home.length);
  const sides = [
    { key: "away" as const, id: awayId, side: game.away },
    { key: "home" as const, id: homeId, side: game.home },
  ];
  const hits = (s: (typeof sides)[number]) => s.side.lineup.reduce((n, b) => n + (game.bat.get(b.id)?.h ?? 0), 0);
  const name = (id: number) => getTeamById(id)?.abbrev ?? String(id);

  return (
    <div className="space-y-4 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-center tabular-nums">
          <thead className="text-white/55">
            <tr>
              <th className="py-1 text-left font-medium">Team</th>
              {Array.from({ length: innings }, (_, i) => (
                <th key={i} className="w-6 font-medium">
                  {i + 1}
                </th>
              ))}
              <th className="w-7 font-semibold text-white">R</th>
              <th className="w-7 font-medium">H</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((s) => (
              <tr key={s.key} className="border-t border-white/10">
                <td className="py-1 text-left font-semibold">{name(s.id)}</td>
                {Array.from({ length: innings }, (_, i) => (
                  <td key={i}>{game.line[s.key][i] ?? (game.final && s.key === "home" && i === game.line.home.length ? "x" : "")}</td>
                ))}
                <td className="font-bold">{game.score[s.key]}</td>
                <td>{hits(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sides.map((s) => {
          const staff = [...s.side.team.rotation, ...s.side.team.bullpen];
          const used = [...game.pit.entries()].filter(([id]) => staff.some((p) => p.id === id));
          return (
            <div key={s.key} className="space-y-2">
              <table className="w-full border-collapse tabular-nums">
                <thead className="text-white/55">
                  <tr>
                    <th className="py-1 text-left font-medium">{name(s.id)} batting</th>
                    {["AB", "R", "H", "RBI", "BB", "K", "HR"].map((h) => (
                      <th key={h} className="w-7 text-right font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.side.lineup.map((b) => {
                    const l = game.bat.get(b.id);
                    return (
                      <tr key={b.id} className="border-t border-white/5">
                        <td className="truncate py-0.5 pr-2">
                          {b.name} <span className="text-white/45">{b.pos}</span>
                        </td>
                        {[l?.ab, l?.r, l?.h, l?.rbi, l?.bb, l?.k, l?.hr].map((v, i) => (
                          <td key={i} className="text-right">
                            {v ?? 0}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <table className="w-full border-collapse tabular-nums">
                <thead className="text-white/55">
                  <tr>
                    <th className="py-1 text-left font-medium">Pitching</th>
                    {["IP", "H", "R", "BB", "K", "HR", "P"].map((h) => (
                      <th key={h} className="w-7 text-right font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {used.map(([id, l]) => (
                    <tr key={id} className="border-t border-white/5">
                      <td className="truncate py-0.5 pr-2">{game.name(id)}</td>
                      {[ip(l.outs), l.h, l.r, l.bb, l.k, l.hr, l.pitches].map((v, i) => (
                        <td key={i} className="text-right">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
