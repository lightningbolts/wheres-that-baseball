"use client";

import { activePlayers, autoDepth, isHealthy, positionWarning } from "@/lib/game/franchise/roster";
import { FIELD_SPOTS, type LineupPos, type Player } from "@/lib/game/franchise/types";
import { avg, era, ops } from "@/lib/game/franchise/stats";
import { cn } from "@/lib/utils";
import { Btn, Card, Ovr, SmallBtn, Table, td, th, type TabProps } from "../ui";

const sel = "rounded border border-border bg-background px-1.5 py-1 text-sm";

function batLine(p: Player): string {
  const s = p.stats.bat;
  return s?.pa ? `${avg(s).toFixed(3).replace(/^0/, "")} / ${s.hr} HR / ${ops(s).toFixed(3).replace(/^0/, "")}` : "";
}

export function LineupTab({ league, act }: TabProps) {
  const me = league.userTeam;
  const t = league.teams[me];
  const act26 = activePlayers(league, me).filter(isHealthy);
  const hitters = act26.filter((p) => !p.pitcher).sort((a, b) => b.ovr - a.ovr);
  const pitchers = act26.filter((p) => p.pitcher && p.pit).sort((a, b) => b.ovr - a.ovr);
  const inLineup = new Set(t.lineup.map((s) => s.id));
  const bench = hitters.filter((p) => !inLineup.has(p.id));
  const dupes = FIELD_SPOTS.filter((pos) => t.lineup.filter((s) => s.pos === pos).length !== 1);
  const pen = pitchers.filter((p) => !t.rotation.includes(p.id));

  const move = <T,>(arr: T[], i: number, d: number): T[] => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const out = [...arr];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Batting order"
        right={
          <Btn
            onClick={() =>
              act((l) => {
                autoDepth(l, me);
                return "Depth chart set to the best available.";
              })
            }
          >
            Auto lineup & staff
          </Btn>
        }
      >
        {dupes.length > 0 && <p className="mb-2 text-xs text-amber-500">Each position needs exactly one player (check {dupes.join(", ")}). Fixed automatically before the next game.</p>}
        <Table>
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Player</th>
              <th className={th}>Pos</th>
              <th className={th}>OVR</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {t.lineup.map((s, i) => {
              const p = league.players[s.id];
              if (!p) return null;
              const warn = positionWarning(p, s.pos);
              return (
                <tr key={s.id}>
                  <td className={cn(td, "text-secondary")}>{i + 1}</td>
                  <td className={td}>
                    <select
                      className={cn(sel, "max-w-[11rem]")}
                      value={s.id}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        act((l) => {
                          const lt = l.teams[me];
                          const other = lt.lineup.findIndex((x) => x.id === id);
                          if (other >= 0) [lt.lineup[i].pos, lt.lineup[other].pos] = [lt.lineup[other].pos, lt.lineup[i].pos];
                          if (other >= 0) [lt.lineup[i], lt.lineup[other]] = [lt.lineup[other], lt.lineup[i]];
                          else lt.lineup[i] = { id, pos: lt.lineup[i].pos };
                        });
                      }}
                    >
                      <option value={p.id}>{p.name}</option>
                      {bench.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.pos}, {b.ovr})
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-secondary">
                      {batLine(p)}
                      {warn && <span className="text-amber-500"> {warn}</span>}
                    </div>
                  </td>
                  <td className={td}>
                    <select
                      className={sel}
                      value={s.pos}
                      onChange={(e) => {
                        const pos = e.target.value as LineupPos;
                        act((l) => {
                          const lt = l.teams[me];
                          const holder = lt.lineup.findIndex((x) => x.pos === pos);
                          if (holder >= 0) lt.lineup[holder] = { ...lt.lineup[holder], pos: lt.lineup[i].pos };
                          lt.lineup[i] = { ...lt.lineup[i], pos };
                        });
                      }}
                    >
                      {FIELD_SPOTS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={td}>
                    <Ovr v={p.ovr} />
                  </td>
                  <td className={cn(td, "whitespace-nowrap")}>
                    <SmallBtn
                      disabled={i === 0}
                      onClick={() =>
                        act((l) => {
                          l.teams[me].lineup = move(l.teams[me].lineup, i, -1);
                        })
                      }
                    >
                      ↑
                    </SmallBtn>{" "}
                    <SmallBtn
                      disabled={i === t.lineup.length - 1}
                      onClick={() =>
                        act((l) => {
                          l.teams[me].lineup = move(l.teams[me].lineup, i, 1);
                        })
                      }
                    >
                      ↓
                    </SmallBtn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="mt-3 text-xs text-secondary">
          Bench: {bench.map((b) => `${b.name} (${b.pos})`).join(", ") || "none"}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card title="Rotation">
          <Table>
            <tbody>
              {t.rotation.map((id, i) => {
                const p = league.players[id];
                if (!p) return null;
                const s = p.stats.pit;
                return (
                  <tr key={id} className={cn(i === t.rotIdx % Math.max(1, t.rotation.length) && "bg-emerald-500/10")}>
                    <td className={cn(td, "text-secondary")}>SP{i + 1}</td>
                    <td className={td}>
                      <select
                        className={cn(sel, "max-w-[11rem]")}
                        value={id}
                        onChange={(e) => {
                          const nid = Number(e.target.value);
                          act((l) => {
                            const lt = l.teams[me];
                            lt.rotation[i] = nid;
                            if (lt.closer === nid) lt.closer = id;
                            lt.setup = lt.setup.map((x) => (x === nid ? id : x));
                          });
                        }}
                      >
                        <option value={id}>{p.name}</option>
                        {pen.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.pos}, {b.ovr})
                          </option>
                        ))}
                      </select>
                      <div className="text-[11px] text-secondary">{s?.outs ? `${s.w}-${s.l}, ${era(s).toFixed(2)} ERA` : `stamina ${Math.round(p.pit?.stam ?? 0)}`}</div>
                    </td>
                    <td className={td}>
                      <Ovr v={p.ovr} />
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      <SmallBtn
                        disabled={i === 0}
                        onClick={() =>
                          act((l) => {
                            l.teams[me].rotation = move(l.teams[me].rotation, i, -1);
                          })
                        }
                      >
                        ↑
                      </SmallBtn>{" "}
                      <SmallBtn
                        disabled={i === t.rotation.length - 1}
                        onClick={() =>
                          act((l) => {
                            l.teams[me].rotation = move(l.teams[me].rotation, i, 1);
                          })
                        }
                      >
                        ↓
                      </SmallBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-secondary">Highlighted: next turn. Starters need four days of rest; a tired starter is skipped.</p>
        </Card>
        <Card title="Bullpen roles">
          <div className="space-y-2 text-sm">
            <label className="flex items-center justify-between gap-2">
              <span className="text-secondary">Closer</span>
              <select
                className={sel}
                value={t.closer ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  act((l) => {
                    const lt = l.teams[me];
                    lt.setup = lt.setup.filter((x) => x !== id);
                    lt.closer = id;
                  });
                }}
              >
                {pen.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.ovr})
                  </option>
                ))}
              </select>
            </label>
            {[0, 1].map((k) => (
              <label key={k} className="flex items-center justify-between gap-2">
                <span className="text-secondary">Setup {k + 1}</span>
                <select
                  className={sel}
                  value={t.setup[k] ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    act((l) => {
                      const lt = l.teams[me];
                      const s = lt.setup.filter((x) => x !== id);
                      s.splice(k, 0, id);
                      lt.setup = s.slice(0, 2);
                    });
                  }}
                >
                  <option value="">—</option>
                  {pen
                    .filter((b) => b.id !== t.closer)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.ovr})
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <div className="pt-1 text-xs text-secondary">
              Pen: {pen.map((b) => `${b.name} ${b.ovr}`).join(", ")}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
