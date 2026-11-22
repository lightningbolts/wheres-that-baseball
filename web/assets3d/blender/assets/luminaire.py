"""
A stadium floodlight luminaire: a deep spun-aluminium reflector housing with a stepped
rear and cooling fins, a rolled rim and bezel round a slightly recessed glass lens, and a
glare hood over the top that is longest at the crown and runs out down the sides — hung
in a flat-bar trunnion yoke with pivot bosses, on a stub to the rack. 2.9 ft across,
centred on the origin, the lens facing the web scene's +Z (Blender −Y), tipped 12° down.
The scene instances it in a grid over every lamp rack; the lens — and only the lens — is
vertex-coloured pure white so the runtime can light it up at night (anything whose colour
is above 0.95 glows). The lens has its own vertices, so its edge stays crisp.
"""
import math

import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "luminaire",
    "description": "Stadium floodlight luminaire, 2.9 ft, lens toward +Z; white lens glows at night",
    "lods": [400, 90],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

HOUSING = np.array([0.10, 0.105, 0.11])
RIM = np.array([0.30, 0.31, 0.32])
YOKE = np.array([0.36, 0.37, 0.39])
LENS = np.array([1.0, 1.0, 1.0])
AIM = kit.rot_x(math.radians(102))  # lathe +Z → front (−Y), tipped 12° down
LENS_R = 1.27
LENS_Z = 0.21


def build_lod(segments: int, detailed: bool):
    k = kit.Kit()
    if detailed:
        profile = [(0.62, -1.47), (0.70, -1.08), (1.12, -0.86), (1.38, -0.32), (1.46, 0.12), (1.53, 0.15), (1.53, 0.31), (1.36, 0.32), (LENS_R, LENS_Z)]
    else:
        profile = [(1.2, -0.75), (1.53, 0.31), (LENS_R, LENS_Z)]

    def colour(r, z, a):
        if z >= 0.1:
            return RIM * (0.8 if r < 1.4 else 1.0)  # bezel darker than the rolled rim
        # Housing: lighter on top (sky), darker below, a paler band where the spinning steps.
        return HOUSING * (0.8 + 0.45 * max(0.0, math.sin(a))) * (1.25 if -1.1 < z < -0.8 else 1.0)

    def ring(r, z):
        return [AIM @ np.array([r * math.cos(2 * math.pi * j / segments), r * math.sin(2 * math.pi * j / segments), z]) for j in range(segments)]

    k.lathe(profile, segments, colour, axis_rot=AIM, cap_ends=False)
    r0, z0 = profile[0]
    back = ring(r0, z0)
    if detailed:
        # Flat back plate.
        k.add(back, [tuple(reversed(range(segments)))], HOUSING * 0.9)
    else:
        # The rear of the housing as one cone.
        k.add([AIM @ np.array([0, 0, -1.48])] + back, [(0, 1 + (j + 1) % segments, 1 + j) for j in range(segments)], [HOUSING] + [colour(r0, z0, 2 * math.pi * j / segments) for j in range(segments)])
    # The glass: its own vertices, all pure white.
    k.add(ring(LENS_R, LENS_Z), [tuple(range(segments))], LENS)

    # Glare hood over the top of the rim: longest at the crown, running out at the sides.
    spans = 7 if detailed else 3
    lo, hi = math.radians(-12), math.radians(192)
    edge = []
    for i in range(spans + 1):
        a = lo + (hi - lo) * i / spans
        reach = 0.18 + 1.0 * max(0.0, math.sin(a)) ** 1.5
        edge.append((AIM @ np.array([1.54 * math.cos(a), 1.54 * math.sin(a), 0.28]), AIM @ np.array([1.6 * math.cos(a), 1.6 * math.sin(a), 0.28 + reach])))
    for (a0, a1), (b0, b1) in zip(edge[:-1], edge[1:]):
        k.plate([a0, b0, b1, a1], HOUSING * 1.35)

    # Trunnion yoke: flat arms from the pivots either side down to a crossbar behind and
    # below, and a stub back to the rack.
    pivot_l = AIM @ np.array([0, 0, -0.35])
    foot = np.array([0.0, 1.0, -1.6])
    for sx in (-1, 1):
        top = pivot_l + np.array([sx * 1.5, 0, 0])
        bot = foot + np.array([sx * 1.5, 0, 0])
        if detailed:
            k.beam(top + (top - bot) * 0.12, bot, 0.42, YOKE, h=0.12, sides=4, cap=True)  # flat bar, thin across
            # Pivot boss and clamp knob.
            k.beam(top - np.array([sx * 0.1, 0, 0]), top + np.array([sx * 0.14, 0, 0]), 0.5, YOKE * 0.7, sides=5, cap=True)
        else:
            k.beam(top, bot, 0.3, YOKE, sides=3, cap=False)
    k.beam(foot - np.array([1.56, 0, 0]), foot + np.array([1.56, 0, 0]), 0.24 if detailed else 0.3, YOKE, sides=4 if detailed else 3, cap=detailed)
    if detailed:
        k.beam(foot, foot + np.array([0, 0.65, 0]), 0.32, YOKE * 0.85, sides=4, cap=True)
        # Cooling fins round the rear of the housing.
        for i in range(6):
            a = 2 * math.pi * (i + 0.5) / 6
            d = np.array([math.cos(a), math.sin(a), 0.0])
            pts = [d * 0.66 + np.array([0, 0, -1.47]), d * 0.92 + np.array([0, 0, -1.47]), d * 1.22 + np.array([0, 0, -0.84]), d * 0.72 + np.array([0, 0, -1.02])]
            k.plate([AIM @ p for p in pts], HOUSING * 1.5)
    return k


def build():
    mat = materials.pbr("luminaire", roughness=0.45, metallic=0.0)
    objs = []
    for i, (seg, detailed) in enumerate([(14, True), (10, False)]):
        ob = build_lod(seg, detailed).object(f"luminaire_LOD{i}", smooth=True)
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
