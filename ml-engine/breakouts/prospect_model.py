"""Breakout model for ranked prospects who have not yet had a real MLB look.

A row is (prospect on the MLB Pipeline list published before season Y) -> did he have a
breakout season in Y (same definition as the MLB model). Features come only from what was
known before Y: list rank, scouting grades, ETA, and his season Y-1 minor-league line
adjusted for level and age-for-level, plus any brief MLB time in Y-1.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from prospects import LEVELS, fetch_milb, fetch_rankings

PITCHER_POS = ("RHP", "LHP", "P")


def is_pitcher(position: str) -> bool:
    return (position or "").split("/")[0].strip().upper() in PITCHER_POS


def _ip(value) -> float:
    s = str(value or "0")
    whole, _, frac = s.partition(".")
    return int(whole or 0) + (int(frac or 0) / 3 if frac else 0)


def milb_hitting(season: int, refresh: bool = False) -> pd.DataFrame:
    """One row per (player, level) with summed counting stats and level-relative rates."""
    frames = []
    for sid, (code, score) in LEVELS.items():
        df = pd.DataFrame(fetch_milb("hitting", sid, season, refresh=refresh))
        if df.empty:
            continue
        num = ["plateAppearances", "atBats", "hits", "doubles", "triples", "homeRuns", "baseOnBalls",
               "hitByPitch", "sacFlies", "strikeOuts", "stolenBases", "age"]
        df = df[["player_id", *num]].apply(pd.to_numeric, errors="coerce")
        df["age_w"] = df["age"] * df["plateAppearances"]
        g = df.groupby("player_id").sum().reset_index()
        g["age"] = g["age_w"] / g["plateAppearances"].replace(0, np.nan)
        g = g[g["plateAppearances"] > 0]
        g["level"], g["level_score"] = code, score
        tb = g["hits"] + g["doubles"] + 2 * g["triples"] + 3 * g["homeRuns"]
        obp_den = (g["atBats"] + g["baseOnBalls"] + g["hitByPitch"] + g["sacFlies"]).replace(0, np.nan)
        g["obp"] = (g["hits"] + g["baseOnBalls"] + g["hitByPitch"]) / obp_den
        g["slg"] = tb / g["atBats"].replace(0, np.nan)
        g["avg"] = g["hits"] / g["atBats"].replace(0, np.nan)
        g["ops"] = g["obp"] + g["slg"]
        g["iso"] = g["slg"] - g["avg"]
        g["k_pct"] = 100 * g["strikeOuts"] / g["plateAppearances"]
        g["bb_pct"] = 100 * g["baseOnBalls"] / g["plateAppearances"]
        w = g["plateAppearances"]
        for col in ("ops", "iso", "k_pct", "bb_pct", "age"):
            lg = np.average(g[col].fillna(g[col].median()), weights=w)
            g[f"{col}_lg"] = lg
        frames.append(g)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def milb_pitching(season: int, refresh: bool = False) -> pd.DataFrame:
    frames = []
    for sid, (code, score) in LEVELS.items():
        df = pd.DataFrame(fetch_milb("pitching", sid, season, refresh=refresh))
        if df.empty:
            continue
        df["ip"] = df["inningsPitched"].map(_ip)
        num = ["battersFaced", "earnedRuns", "strikeOuts", "baseOnBalls", "homeRuns", "gamesStarted",
               "gamesPitched", "age"]
        df = pd.concat([df[["player_id", "ip"]], df[num].apply(pd.to_numeric, errors="coerce")], axis=1)
        df["age_w"] = df["age"] * df["battersFaced"]
        g = df.groupby("player_id").sum().reset_index()
        g["age"] = g["age_w"] / g["battersFaced"].replace(0, np.nan)
        g = g[g["battersFaced"] > 0]
        g["level"], g["level_score"] = code, score
        g["era"] = 9 * g["earnedRuns"] / g["ip"].replace(0, np.nan)
        g["k_pct"] = 100 * g["strikeOuts"] / g["battersFaced"]
        g["bb_pct"] = 100 * g["baseOnBalls"] / g["battersFaced"]
        g["kbb"] = g["k_pct"] - g["bb_pct"]
        g["hr9"] = 9 * g["homeRuns"] / g["ip"].replace(0, np.nan)
        w = g["battersFaced"]
        for col in ("era", "k_pct", "bb_pct", "kbb", "age"):
            g[f"{col}_lg"] = np.average(g[col].fillna(g[col].median()), weights=w)
        frames.append(g)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _summarize(lines: pd.DataFrame, vol: str, rel_cols: list[str]) -> dict:
    """Collapse a player's level lines into one volume-weighted, level-relative profile."""
    lines = lines.sort_values("level_score", ascending=False)
    top = lines[lines[vol] >= (50 if vol == "plateAppearances" else 40)]
    top_score = int(top["level_score"].max()) if not top.empty else int(lines["level_score"].max())
    # Use Double-A and up when there is enough of it, otherwise everything.
    upper = lines[lines["level_score"] >= 2]
    use = upper if upper[vol].sum() >= (100 if vol == "plateAppearances" else 30) else lines
    w = use[vol]
    out = {
        "top_level": top_score,
        "milb_volume": float(lines[vol].sum()),
        "upper_volume": float(upper[vol].sum()),
        "aaa_volume": float(lines.loc[lines["level_score"] == 3, vol].sum()),
        "age_vs_level": float(np.average(use["age_lg"] - use["age"], weights=w)),
        "milb_age": float(np.average(use["age"], weights=w)),
        "used_levels": "/".join(use["level"]),
    }
    for col in rel_cols:
        out[f"{col}_rel"] = float(np.average(use[col] - use[f"{col}_lg"], weights=w))
        out[f"{col}_raw"] = float(np.average(use[col], weights=w))
    return out


HIT_P_FEATURES = [
    "log_overall", "org_rank", "fv", "g_hit", "g_power", "eta_gap", "age_c",
    "top_level", "upper_volume", "aaa_volume", "age_vs_level",
    "ops_rel", "iso_rel", "k_pct_rel", "bb_pct_rel", "mlb_prev",
]


def build_prospect_rows(season: int, kind: str, mlb_prev: dict[int, float],
                        refresh: bool = False) -> pd.DataFrame:
    """Rows for the list published before `season`, using stats from the prior MiLB season."""
    stat_year = season - 1 if season - 1 != 2020 else 2019  # no 2020 minor-league season
    ranks = [r for r in fetch_rankings(season, refresh=refresh) if is_pitcher(r["position"]) == (kind == "pitcher")]
    milb = milb_hitting(stat_year, refresh) if kind == "hitter" else milb_pitching(stat_year, refresh)
    vol = "plateAppearances" if kind == "hitter" else "ip"
    rel = ["ops", "iso", "k_pct", "bb_pct"] if kind == "hitter" else ["era", "k_pct", "bb_pct", "kbb"]
    by_player = {pid: g for pid, g in milb.groupby("player_id")} if not milb.empty else {}
    rows = []
    for r in ranks:
        pid = r["player_id"]
        g = r.get("grades") or {}
        row = {
            "player_id": pid, "year": season, "name": r["name"], "position": r["position"],
            "overall_rank": r["overall_rank"], "org_rank": r["org_rank"] or 31, "org": r.get("org"),
            "log_overall": np.log(r["overall_rank"]) if r["overall_rank"] else np.log(150),
            "fv": g.get("overall"), "g_hit": g.get("hit"), "g_power": g.get("power"),
            "grades": g, "eta": r.get("eta"),
            # Historical lists are preseason, so ETA is never already past; the live list used for
            # scoring often is. Clip to the trained range: "ETA this year or earlier" = ready now.
            "eta_gap": max(r["eta"] - season, 0) if r.get("eta") else np.nan,
            "mlb_prev": float(mlb_prev.get(pid, 0.0)),
            "stat_year": stat_year,
        }
        lines = by_player.get(pid)
        if lines is not None and lines[vol].sum() > 0:
            row.update(_summarize(lines, vol, rel))
            if kind == "pitcher":
                row["gs_share"] = float(lines["gamesStarted"].sum() / max(lines["gamesPitched"].sum(), 1))
                row["milb_k"] = int(lines["strikeOuts"].sum())
                row["milb_hr_lines"] = None
            else:
                row["milb_hr"] = int(lines["homeRuns"].sum())
                row["milb_sb"] = int(lines["stolenBases"].sum())
            row["age"] = row["milb_age"] + 1
            row["age_c"] = float(np.clip(row["age"], 19, 27))  # almost no 27+ prospects in training
        else:
            row.update({"top_level": -1, "milb_volume": 0.0, "upper_volume": 0.0, "aaa_volume": 0.0})
        rows.append(row)
    return pd.DataFrame(rows)


# Pitcher set chosen by walk-forward backtest (2019-2025 outcome seasons): the pitching line
# beyond K-BB% (ERA, BB%, starter share) added noise, not signal.
PIT_P_FEATURES = [
    "log_overall", "org_rank", "fv", "eta_gap", "age_c", "top_level", "upper_volume", "aaa_volume",
    "age_vs_level", "mlb_prev", "kbb_rel",
]
PROSPECT_C = {"hitter": 0.05, "pitcher": 0.2}
FIRST_LIST = 2016  # needs a prior minor-league season (2015) to describe each prospect

ORG_NAMES = {
    "dbacks": "D-backs", "braves": "Braves", "orioles": "Orioles", "redsox": "Red Sox", "cubs": "Cubs",
    "whitesox": "White Sox", "reds": "Reds", "guardians": "Guardians", "rockies": "Rockies", "tigers": "Tigers",
    "astros": "Astros", "royals": "Royals", "angels": "Angels", "dodgers": "Dodgers", "marlins": "Marlins",
    "brewers": "Brewers", "twins": "Twins", "mets": "Mets", "yankees": "Yankees", "athletics": "Athletics",
    "phillies": "Phillies", "pirates": "Pirates", "padres": "Padres", "giants": "Giants", "mariners": "Mariners",
    "cardinals": "Cardinals", "rays": "Rays", "rangers": "Rangers", "bluejays": "Blue Jays", "nationals": "Nationals",
}
LEVEL_NAME = {3: "Triple-A", 2: "Double-A", 1: "High-A", 0: "Single-A", -1: "no full-season ball"}


def prospect_frame(kind: str, all_df: pd.DataFrame, feat: pd.DataFrame, seasons: range,
                   min_mlb: float, refresh: bool = False) -> pd.DataFrame:
    """Prospect rows for each list season, labeled with a breakout in that season.

    Excludes anyone already established, and anyone with enough MLB time the season before to be
    scored by the main model instead.
    """
    vcol = "pa" if kind == "hitter" else "ip"
    out = []
    for season in seasons:
        prev = all_df[all_df["year"] == season - 1].groupby("player_id")[vcol].sum().to_dict()
        rows = build_prospect_rows(season, kind, prev, refresh)
        est = feat[feat["year"] < season].groupby("player_id")["established_season"].max()
        rows = rows[~rows["player_id"].map(est).fillna(False).astype(bool)]
        rows = rows[rows["mlb_prev"] < min_mlb]
        lab = all_df[all_df["year"] == season].groupby("player_id")["breakout_season"].max()
        rows["label"] = rows["player_id"].map(lab).fillna(False).astype(bool)
        out.append(rows)
    return pd.concat(out, ignore_index=True)


# ---------------------------------------------------------------- explanations

def _ordinal_rank(r: pd.Series) -> str:
    org = ORG_NAMES.get(r.get("org") or "", "")
    if pd.notna(r.get("overall_rank")):
        return f"MLB Pipeline No. {int(r['overall_rank'])} overall" + (f" (No. {int(r['org_rank'])} {org})" if org and r["org_rank"] <= 30 else "")
    return f"No. {int(r['org_rank'])} prospect in the {org} system" if org else "Ranked organizational prospect"


def _level_phrase(r: pd.Series, kind: str) -> str:
    unit = "PA" if kind == "hitter" else "IP"
    aaa, upper = r.get("aaa_volume") or 0, r.get("upper_volume") or 0
    fmt = (lambda v: f"{int(v)}") if kind == "hitter" else (lambda v: f"{v:.0f}")
    if aaa >= (100 if kind == "hitter" else 25):
        return f"{fmt(aaa)} {unit} at Triple-A in {int(r['stat_year'])}"
    if upper > 0:
        where = "Double-A" if aaa == 0 else "Double-A and Triple-A"
        return f"{fmt(upper)} {unit} at {where} in {int(r['stat_year'])}"
    return f"Topped out at {LEVEL_NAME.get(int(r['top_level']), 'the low minors')} in {int(r['stat_year'])}"


def _rate3(x: float) -> str:
    return f"{x:.3f}".lstrip("0")


def prospect_sentence(feature: str, r: pd.Series, kind: str, good: bool) -> str | None:
    lv = r.get("used_levels") or ""
    lv_txt = {"AAA": "Triple-A", "AA": "Double-A"}.get(lv, lv.replace("/", "/"))
    if feature in ("log_overall", "org_rank"):
        return _ordinal_rank(r) if good else (
            "Outside the Top 100: scouts see a lower ceiling than the elite names"
            if pd.isna(r.get("overall_rank")) else None)
    if feature == "fv" and pd.notna(r.get("fv")):
        g = r.get("grades") or {}
        tools = [f"{k} {v}" for k, v in g.items() if k not in ("overall",) and v >= 60]
        txt = f"{int(r['fv'])} future-value grade"
        if tools:
            txt += " with plus tools (" + ", ".join(t.capitalize() for t in tools[:3]) + ")"
        return txt if good else f"Modest {int(r['fv'])} future-value grade"
    if feature == "g_hit" and pd.notna(r.get("g_hit")):
        return f"{int(r['g_hit'])}-grade hit tool" if good else f"Hit tool graded {int(r['g_hit'])}: contact is the question"
    if feature == "g_power" and pd.notna(r.get("g_power")):
        return f"{int(r['g_power'])}-grade power" if good else None
    if feature == "eta_gap":
        if pd.isna(r.get("eta")):
            return None
        if not good:
            return f"Pipeline ETA {int(r['eta'])}: may not get a full MLB season in {int(r['year'])}"
        if r["eta"] < r["year"]:
            return f"Pipeline ETA was {int(r['eta'])}: considered big-league ready now"
        return f"Pipeline ETA {int(r['eta'])}"
    if feature in ("top_level", "aaa_volume", "upper_volume"):
        if good:
            return _level_phrase(r, kind)
        if r["top_level"] < 3:
            return f"No Triple-A time yet (topped out at {LEVEL_NAME.get(int(r['top_level']), 'the low minors')})"
        return None
    if feature == "age_vs_level" and pd.notna(r.get("age_vs_level")):
        yrs = r["age_vs_level"]
        if good and yrs >= 1.0:
            return f"Played {int(round(r['milb_age']))} at {lv_txt}, {yrs:.1f} years younger than the league average"
        if not good and yrs <= -0.5:
            return f"Old for his level ({int(round(r['milb_age']))} at {lv_txt})"
        return None
    if feature == "age_c":
        return None  # older = closer to ready; not a selling point worth a bullet
    if feature == "mlb_prev" and r.get("mlb_prev", 0) > 0:
        unit = "PA" if kind == "hitter" else "IP"
        val = f"{int(r['mlb_prev'])}" if kind == "hitter" else f"{r['mlb_prev']:.0f}"
        return f"Already got a {val}-{unit} MLB look in {int(r['stat_year'])}" if good else None
    if kind == "hitter" and pd.notna(r.get("ops_raw")):
        if feature == "ops_rel":
            sign = "+" if r["ops_rel"] >= 0 else "−"
            return (f"{_rate3(r['ops_raw'])} OPS at {lv_txt}, {sign}{_rate3(abs(r['ops_rel']))} vs. league"
                    if good == (r["ops_rel"] >= 0) else None)
        if feature == "iso_rel":
            if good and r["iso_rel"] >= 0.03:
                return f"{_rate3(r['iso_raw'])} ISO at {lv_txt}, {_rate3(r['iso_rel'])} above league"
            if not good and r["iso_rel"] <= -0.02:
                return f"Limited power so far ({_rate3(r['iso_raw'])} ISO at {lv_txt})"
            return None
        if feature == "k_pct_rel":
            if good and r["k_pct_rel"] < 0:
                return f"{r['k_pct_raw']:.1f}% strikeout rate at {lv_txt}, {abs(r['k_pct_rel']):.1f} pts better than league"
            if not good and r["k_pct_rel"] > 0:
                return f"{r['k_pct_raw']:.1f}% strikeout rate at {lv_txt} ({r['k_pct_rel']:.1f} pts worse than league)"
            return None
        if feature == "bb_pct_rel":
            if good and r["bb_pct_rel"] >= 1.5:
                return f"{r['bb_pct_raw']:.1f}% walk rate at {lv_txt}, {r['bb_pct_rel']:.1f} pts above league"
            if not good and r["bb_pct_rel"] <= -1.5:
                return f"{r['bb_pct_raw']:.1f}% walk rate at {lv_txt}, below league average"
            return None
    if kind == "pitcher" and pd.notna(r.get("kbb_raw")) and feature == "kbb_rel":
        if good == (r["kbb_rel"] >= 0):
            return (f"{r['kbb_raw']:.1f}% K-BB at {lv_txt} ({r['k_pct_raw']:.0f}% K, {r['bb_pct_raw']:.0f}% BB), "
                    f"{abs(r['kbb_rel']):.1f} pts {'above' if r['kbb_rel'] >= 0 else 'below'} league")
        return None
    return None


def explain_prospect(model, features: list[str], r: pd.Series, kind: str) -> tuple[list[str], str | None]:
    pre = model[:-1]
    z = pre.transform(pd.DataFrame([r[features].astype(float)]))[0]
    contrib = model[-1].coef_[0] * z
    order = np.argsort(-contrib)
    drivers, seen = [], set()
    groups = {"org_rank": "rank", "log_overall": "rank", "top_level": "lvl", "aaa_volume": "lvl", "upper_volume": "lvl"}
    for i in order:
        if contrib[i] <= 0 or len(drivers) >= 4:
            break
        f = features[i]
        key = groups.get(f, f)
        if key in seen:
            continue
        txt = prospect_sentence(f, r, kind, True)
        if txt:
            drivers.append(txt)
            seen.add(key)
    risk = None
    for i in np.argsort(contrib):
        if contrib[i] >= 0:
            break
        txt = prospect_sentence(features[i], r, kind, False)
        if txt:
            risk = txt
            break
    return drivers, risk


def prospect_bar(r: pd.Series, kind: str, lg_woba: float, lg_era: float, hit_pa: int, hit_woba: float,
                 sp_ip: int, sp_runs: float) -> str:
    year = int(r["year"])
    if kind == "hitter":
        need = f"a regular's job and {hit_pa}+ PA at a {_rate3(lg_woba + hit_woba)} wOBA (≈120 wRC+), 30 HR, or a ROY / All-Star season"
        if r["top_level"] < 3:
            return f"Has to reach Triple-A and force a call-up early in {year}, then hold {need}."
        return f"Needs {need}."
    target = lg_era - sp_runs
    if (r.get("gs_share") or 0) >= 0.5:
        return f"Needs a rotation spot and {sp_ip}+ IP at ~{target:.2f} ERA/xERA, 200 K, or a ROY / All-Star season."
    return f"Needs {sp_ip}+ IP at ~{target:.2f} ERA, an elite relief season (50+ IP, 20%+ K-BB), or a ROY / All-Star season."


def prospect_profile(r: pd.Series, kind: str) -> str:
    bits = []
    if pd.notna(r.get("overall_rank")):
        bits.append(f"No. {int(r['overall_rank'])} overall")
    elif r.get("org_rank", 31) <= 30:
        bits.append(f"No. {int(r['org_rank'])} in org")
    if kind == "hitter" and pd.notna(r.get("ops_raw")):
        bits.append(f"{_rate3(r['ops_raw'])} OPS at {r.get('used_levels')}")
    if kind == "pitcher" and pd.notna(r.get("kbb_raw")):
        bits.append(f"{r['kbb_raw']:.0f}% K-BB at {r.get('used_levels')}")
    if pd.notna(r.get("milb_age")):
        bits.append(f"age {int(round(r['milb_age']))}")
    return ", ".join(bits)
