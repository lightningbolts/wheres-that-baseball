"""
Lattice floodlight mast: four tapering galvanised legs, X-braced on every face in panels
that shorten as the tower narrows (so the braces keep their angle, as on a real tower),
with a strut ring at every panel joint, bolted leg splices, gussets where the braces
cross, plan bracing and grating rest decks inside, and a caged ladder and cable conduit
up the inside of the back face, on concrete piers with a switchgear cabinet at the foot.
Authored 160 ft tall from the origin (base) up; the scene scales it in height to each
tower and puts the platform and lamp rack on top. The leg footprint matches props.ts
lightBanks: half-width 8 − 5.6t ft across, 0.7 of that front-to-back, centred 4 ft behind
the frame origin (web +Z is toward home plate, Blender −Y).
"""
import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "light_mast",
    "description": "Lattice light-tower mast, 160 ft tall (scaled in height per tower)",
    "lods": [3600, 800],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

H = 160.0
STEEL = np.array([0.40, 0.42, 0.44])
DARK = np.array([0.20, 0.21, 0.22])
CONCRETE = np.array([0.52, 0.51, 0.48])
CABINET = np.array([0.30, 0.34, 0.33])
CORNERS = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
PANELS = 12


def leg(k: int, t: float) -> np.ndarray:
    w = 8 - 5.6 * t
    cx, cz = CORNERS[k]
    # web (lx, y, lz) → Blender (x, −z, y); lz = −4 + cz·0.7w
    return np.array([cx * w, -(-4 + cz * w * 0.7), H * t])


def joints(n: int) -> list[float]:
    """Panel joints as height fractions: each panel as tall, relative to the tower's width there, as the last."""
    rho = (2.4 / 8.0) ** (1 / n)
    return [(8 - 8 * rho**j) / 5.6 for j in range(n)] + [1.0]


def grime(t: float) -> np.ndarray:
    return STEEL * (0.70 + 0.30 * min(1.0, t * 3.5))


def build_lod(detailed: bool):
    k = kit.Kit()
    rng = np.random.default_rng(3)
    ts = joints(PANELS)
    if not detailed:
        ts = ts[::2]
    n = len(ts) - 1

    for c in range(4):
        nxt = (c + 1) % 4
        # Legs: one length per panel, so the colour can grime toward the ground.
        cuts = ts if detailed else [0.0, ts[1], ts[3], 1.0]
        for t0, t1 in zip(cuts[:-1], cuts[1:]):
            k.beam(leg(c, t0), leg(c, t1), 1.25 - 0.4 * t0, grime(t0), sides=4, cap=False, w1=1.25 - 0.4 * t1, color1=grime(t1))
        for j in range(n):
            t0, t1 = ts[j], ts[j + 1]
            tone = rng.uniform(0.9, 1.04)
            # Strut ring at the top of the panel, X-brace across it.
            k.beam(leg(c, t1), leg(nxt, t1), 0.6 if j < n - 1 else 0.8, grime(t1) * tone, h=0.45, sides=4, cap=False)
            brace = 0.5 if detailed else 0.62
            a0, a1, b0, b1 = leg(c, t0), leg(nxt, t1), leg(nxt, t0), leg(c, t1)
            k.beam(a0, a1, brace, grime(t0) * tone * 0.92, sides=3, cap=False, color1=grime(t1) * tone * 0.92)
            k.beam(b0, b1, brace, grime(t0) * tone * 0.88, sides=3, cap=False, color1=grime(t1) * tone * 0.88)
            if detailed and j < 9:
                # Gusset where the braces cross and bolt together, just proud of the face.
                mid = (a0 + a1 + b0 + b1) / 4
                out = np.cross(a1 - a0, b1 - b0)
                out /= np.linalg.norm(out)
                if out @ (mid - np.array([0, 4, mid[2]])) < 0:
                    out = -out
                along = (leg(nxt, t0) - leg(c, t0)) / np.linalg.norm(leg(nxt, t0) - leg(c, t0))
                up = np.cross(out, along)
                s = 0.95 - 0.04 * j
                m = mid + out * 0.3
                k.plate([m - along * s, m - up * s * 1.3, m + along * s, m + up * s * 1.3], grime((t0 + t1) / 2) * 1.08)
        # Pier with a base plate.
        p = leg(c, 0)
        k.box((p[0], p[1], 0.6), (3.6, 3.6, 3.2), CONCRETE * (0.9 if detailed else 1.0), shade_top=1.2)
        if detailed:
            k.box((p[0], p[1], 2.3), (2.4, 2.4, 0.2), grime(0) * 0.8)
            # Bolted splice collars on the leg at every other joint.
            for j in range(2, PANELS, 2):
                q = leg(c, ts[j])
                w = 1.25 - 0.4 * ts[j] + 0.55
                k.box((q[0], q[1], q[2]), (w, w, 0.5), grime(ts[j]) * 1.12)

    # Inside the tower: plan bracing, and grating decks where the ladder breaks.
    decks = (4, 8) if detailed else (2, 4)
    for j in range(1, n):
        t = ts[j]
        if detailed and j % 2 == 0:
            k.beam(leg(0, t), leg(2, t), 0.4, grime(t) * 0.85, sides=3, cap=False)
            k.beam(leg(1, t), leg(3, t), 0.4, grime(t) * 0.85, sides=3, cap=False)
        if j in decks:
            k.plate([leg(c, t) for c in range(4)], DARK * 1.15)

    # Ladder up the inside of the back face (away from the field), in a hoop cage, with
    # the conduit run beside it.
    def back(t: float, off: float, inset: float = 0.9) -> np.ndarray:
        m = (leg(0, t) + leg(1, t)) / 2
        return m + np.array([off, -inset, 0])

    if detailed:
        for off in (-0.75, 0.75):
            k.beam(back(0.012, off), back(1.0, off), 0.2, DARK, sides=3, cap=False)
        rungs = 54
        for i in range(1, rungs):
            t = 0.012 + (1 - 0.012) * i / rungs
            a, b = back(t, -0.75), back(t, 0.75)
            dz = np.array([0, 0, 0.09])
            k.plate([a - dz, b - dz, b + dz, a + dz], DARK * 1.1)
        hoops = 26
        ang = np.linspace(0, np.pi, 5)
        for i in range(hoops):
            t = 0.06 + (1 - 0.07) * i / (hoops - 1)
            m = back(t, 0)
            pts = [m + np.array([1.25 * np.cos(a), -1.25 * np.sin(a), 0]) for a in ang]
            dz = np.array([0, 0, 0.16])
            for a, b in zip(pts[:-1], pts[1:]):
                k.plate([a - dz, b - dz, b + dz, a + dz], DARK * 1.25)
        for a in ang[1:-1]:
            o = np.array([1.25 * np.cos(a), -1.25 * np.sin(a), 0])
            k.beam(back(0.06, 0) + o, back(0.99, 0) + o, 0.14, DARK * 1.2, sides=3, cap=False)
        k.beam(back(0.0, 2.0, 0.5), back(1.0, 2.0, 0.5), 0.42, DARK * 0.85, sides=5, cap=False)
        # Deck handrails on the field side.
        for j in decks:
            t = ts[j]
            a, b = leg(2, t), leg(3, t)
            rail = np.array([0, 0, 3.5])
            k.beam(a + rail, b + rail, 0.2, DARK * 1.3, sides=3, cap=False)
            for f in (0.0, 0.5, 1.0):
                q = a + (b - a) * f
                k.beam(q, q + rail, 0.18, DARK * 1.3, sides=3, cap=False)
    else:
        # Ladder, cage and conduit as one dark run.
        k.beam(back(0.012, 0.3, 1.3), back(1.0, 0.3, 1.3), 1.5, DARK * 1.1, h=1.2, sides=4, cap=False)
    # Switchgear cabinet on a plinth between the back legs.
    c0 = back(0.0, -3.4, 1.6)
    k.box((c0[0], c0[1], 3.4), (3.2, 1.6, 5.2), CABINET, shade_top=1.25)
    k.box((c0[0], c0[1], 0.4), (3.8, 2.2, 0.8), CONCRETE * 0.9)
    return k


def build():
    mat = materials.pbr("light_mast", roughness=0.6, metallic=0.0)
    objs = []
    for i, detailed in enumerate([True, False]):
        ob = build_lod(detailed).object(f"light_mast_LOD{i}")
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
