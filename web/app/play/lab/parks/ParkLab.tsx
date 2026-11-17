"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ballparkIndex from "@/data/ballparks/index.json";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { Ballpark, crowdState } from "@/components/game/scene/Ballpark";
import { Environment } from "@/components/game/scene/parks/Environment";
import type { BallparkIndex } from "@/types/ballpark";

const VENUES = Object.values((ballparkIndex as unknown as BallparkIndex).parks).sort((a, b) => a.teamAbbrev.localeCompare(b.teamAbbrev));
/** A club's current home park (the Rays have two venues on file: Tropicana Field and their 2025 stand-in). */
const venueForTeam = (abbrev: string) => {
  const all = VENUES.filter((v) => v.teamAbbrev === abbrev.toUpperCase());
  return all.find((v) => homeVenueForTeam(v.teamId) === v.venueId) ?? all[0];
};

interface View {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/** Preset cameras (world feet; home plate at the origin, +z toward center field). */
const VIEWS: Record<string, View> = {
  broadcast: { pos: [9, 22, 340], look: [0, 4, 0], fov: 6 },
  cf: { pos: [0, 70, 372], look: [0, 0, 40], fov: 40 },
  home: { pos: [0, 48, -82], look: [0, 10, 220], fov: 62 },
  plate: { pos: [0, 6, -9], look: [0, 12, 200], fov: 62 },
  backstop: { pos: [0, 6, 48], look: [0, 4, -60], fov: 55 },
  pitcher: { pos: [0, 9, 110], look: [0, 3, 0], fov: 20 },
  lf: { pos: [-235, 62, 250], look: [40, 14, 20], fov: 50 },
  rf: { pos: [235, 62, 250], look: [-40, 14, 20], fov: 50 },
  upper: { pos: [215, 120, -105], look: [-30, 0, 190], fov: 58 },
  first: { pos: [-30, 7, 62], look: [120, 16, 30], fov: 40 },
  third: { pos: [30, 7, 62], look: [-120, 16, 30], fov: 40 },
  seats: { pos: [52, 9, 40], look: [110, 16, 0], fov: 30 },
  overhead: { pos: [0, 1050, 150], look: [0, 0, 151], fov: 50 },
  blimp: { pos: [-520, 520, -520], look: [0, 0, 170], fov: 45 },
  street: { pos: [0, 160, 900], look: [0, 40, 100], fov: 45 },
};

function Rig({ view, nonce }: { view: string; nonce: number }) {
  const get = useThree((st) => st.get);
  const controls = useRef<{ target: THREE.Vector3; update(): void } | null>(null);
  useEffect(() => {
    const v = VIEWS[view] ?? VIEWS.home;
    const cam = get().camera as THREE.PerspectiveCamera;
    cam.position.set(...v.pos);
    cam.fov = v.fov;
    cam.updateProjectionMatrix();
    controls.current?.target.set(...v.look);
    controls.current?.update();
  }, [get, view, nonce]);
  return <OrbitControls ref={controls as any} makeDefault maxDistance={4000} zoomSpeed={1.4} />;
}

/** Frame-time readout and renderer stats, written straight into a DOM node. */
function Stats({ report }: { report: (text: string) => void }) {
  const acc = useRef({ t: 0, n: 0, worst: 0 });
  useFrame((state, dt) => {
    const a = acc.current;
    a.t += dt;
    a.n += 1;
    a.worst = Math.max(a.worst, dt);
    if (a.t > 0.5) {
      const r = state.gl.info.render;
      report(`${(a.n / a.t).toFixed(0)} fps · worst ${(a.worst * 1000).toFixed(0)} ms · ${r.calls} calls · ${(r.triangles / 1000).toFixed(0)}k tris`);
      a.t = 0;
      a.n = 0;
      a.worst = 0;
    }
  });
  return null;
}

function param(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function ParkLab() {
  const [ready, setReady] = useState(false);
  const [venueId, setVenueId] = useState(3);
  const [view, setView] = useState("home");
  const [tod, setTod] = useState("day");
  const [nonce, setNonce] = useState(0);
  const stats = useRef<HTMLSpanElement | null>(null);
  const report = useCallback((text: string) => {
    if (stats.current) stats.current.textContent = text;
  }, []);

  useEffect(() => {
    const team = param("team", "").toUpperCase();
    const byTeam = team ? venueForTeam(team) : undefined;
    setVenueId(byTeam?.venueId ?? Number(param("venue", "3")));
    setView(param("view", "home"));
    setTod(param("tod", "day"));
    setReady(true);
  }, []);

  // The scene reads `?tod=` itself, so keep the URL in step and remount on a change.
  useEffect(() => {
    if (!ready) return;
    const v = VENUES.find((x) => x.venueId === venueId);
    const q = new URLSearchParams({ team: v?.teamAbbrev ?? "", view, tod });
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, [ready, venueId, view, tod]);

  // Scripting hook for screenshots: `__lab({ team: "LAD", view: "cf", tod: "night" })`.
  useEffect(() => {
    const w = window as unknown as { __lab?: (o: { team?: string; view?: string; tod?: string }) => void };
    w.__lab = (o) => {
      const v = o.team ? venueForTeam(o.team) : undefined;
      if (v) setVenueId(v.venueId);
      if (o.view) setView(o.view);
      if (o.tod) setTod(o.tod);
      setNonce((n) => n + 1);
    };
    return () => {
      delete w.__lab;
    };
  }, []);

  const park = useMemo(() => buildPark(venueId), [venueId]);
  const color = getTeamColor(park.teamId ?? 0);
  if (!ready) return null;

  const btn = (on: boolean): React.CSSProperties => ({
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid #556",
    background: on ? "#e7c23b" : "#1b2030",
    color: on ? "#111" : "#dde",
    cursor: "pointer",
    font: "12px system-ui",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <Canvas
        key={`${venueId}-${tod}`}
        shadows="soft"
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
        camera={{ position: [0, 48, -82], fov: 62, near: 0.3, far: 6000 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Environment park={park} />
        <Ballpark park={park} homeColor={color} awayColor="#c4ced4" />
        <Rig view={view} nonce={nonce} />
        <Stats report={report} />
      </Canvas>
      <div style={{ position: "absolute", left: 8, top: 8, right: 8, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", pointerEvents: "auto" }}>
        <select value={venueId} onChange={(e) => setVenueId(Number(e.target.value))} style={{ ...btn(false), padding: "3px 4px" }}>
          {VENUES.map((v) => (
            <option key={v.venueId} value={v.venueId}>
              {v.teamAbbrev} — {v.venueName}
            </option>
          ))}
        </select>
        {Object.keys(VIEWS).map((k) => (
          <button
            key={k}
            type="button"
            style={btn(view === k)}
            onClick={() => {
              setView(k);
              setNonce((n) => n + 1);
            }}
          >
            {k}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {["day", "dusk", "night"].map((k) => (
          <button key={k} type="button" style={btn(tod === k)} onClick={() => setTod(k)}>
            {k}
          </button>
        ))}
        <button type="button" style={btn(false)} onClick={() => (crowdState.excite = 1)}>
          cheer
        </button>
        <button type="button" style={btn(false)} onClick={() => (crowdState.away = 1)}>
          away cheer
        </button>
        <span ref={stats} style={{ font: "12px ui-monospace, monospace", color: "#fff", background: "rgba(0,0,0,0.5)", padding: "2px 6px", borderRadius: 4 }} />
      </div>
    </div>
  );
}
