"""
Foul pole: a tapered steel tube in flanged sections, on a gusseted base plate bolted to a
concrete footing, with a ball finial — and the screen on the fair side: a tube frame
clamped to the pole with band brackets, carrying mesh panels between horizontal
stiffeners and a centre stile, and a knee brace under its outer corner. Authored 100 ft
tall from the origin, the screen along web +X (Blender +X) from 0.35 to 4.4 ft out and
54–98 ft up; the scene scales it in height to wall height + 68 ft and turns +X toward fair
territory. Vertex colours are near white: the scene multiplies in the park's paint (the
mesh panels a shade darker than the tube, as open mesh reads against the sky). Single
surfaces throughout: the scene draws this model double-sided.
"""
import math

import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "foul_pole",
    "description": "Foul pole with fair-side screen, 100 ft tall (scaled per park), screen along +X",
    "lods": [1600, 320],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (0.95, 0.82, 0.23),
}

H = 100.0
PAINT = np.array([0.92, 0.92, 0.90])
MESH = PAINT * 0.80
FOOT = np.array([0.45, 0.44, 0.42]) / PAINT * 0.6  # tinted grey once the paint multiplies in
Z0, Z1, X0, X1 = H - 46, H - 2, 0.35, 4.4
BAYS = 8


def radius(z: float) -> float:
    return 0.60 - 0.15 * min(1.0, max(0.0, (z - 1.6) / (H - 2.2)))


def build_lod(detailed: bool):
    k = kit.Kit()
    seg = 16 if detailed else 8
    shade = lambda r, z, a: PAINT * (0.9 + 0.1 * math.cos(a))  # noqa: E731
    k.lathe([(0.68, 0.3), (0.60, 1.6), (0.45, H - 0.6)], seg, shade, cap_ends=False)
    # Ball finial on a short neck.
    ball = [(0.45, H - 0.6), (0.34, H - 0.55)]
    rows = 5 if detailed else 3
    for i in range(rows + 1):
        a = math.pi * (0.16 + 0.84 * i / rows)
        ball.append((max(0.0, 0.66 * math.sin(a)), H - 0.06 - 0.66 * math.cos(a)))
    k.lathe(ball, seg if detailed else 6, lambda r, z, a: PAINT * (0.86 + 0.14 * min(1.0, max(0.0, z - H + 0.6))), cap_ends=False)
    # Base: plate, and gussets and anchor bolts on the close LOD, on the footing.
    k.lathe([(1.35, 0.0), (1.35, 0.3), (0.68, 0.3)], seg, lambda r, z, a: PAINT * 0.82, cap_ends=False)
    k.box((0, 0, -0.4), (3.4, 3.4, 1.0), FOOT, shade_top=1.15)
    if detailed:
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8
            d = np.array([math.cos(a), math.sin(a), 0.0])
            k.add([d * 0.62 + (0, 0, 0.3), d * 1.25 + (0, 0, 0.3), d * 0.6 + (0, 0, 1.5)], [(0, 1, 2)], PAINT * 0.84)
            b = np.array([math.cos(a + 0.39), math.sin(a + 0.39), 0.0]) * 1.12
            k.beam(b + (0, 0, 0.3), b + (0, 0, 0.62), 0.2, FOOT * 0.6, sides=4, cap=True)
        # Section joints: bolted flange rings up the pole.
        for z in (27.0, 52.0, 77.0):
            r = radius(z)
            k.lathe([(r, z - 0.3), (r + 0.16, z - 0.22), (r + 0.16, z + 0.22), (r, z + 0.3)], 12, lambda rr, zz, a: PAINT * (0.84 + 0.1 * math.cos(a)), cap_ends=False)

    # Screen frame.
    sides = 6 if detailed else 4
    tube = 0.24
    for a, b in [((X0, 0, Z0), (X1, 0, Z0)), ((X1, 0, Z0), (X1, 0, Z1)), ((X1, 0, Z1), (X0, 0, Z1)), ((X0, 0, Z1), (X0, 0, Z0))]:
        k.beam(a, b, tube, PAINT, sides=sides, cap=False)
    # The screen: fine mesh reads as a painted panel from the stands, so a panel per bay
    # (each a touch different, as separate sheets of mesh are), between stiffeners.
    rng = np.random.default_rng(41)
    levels = np.linspace(Z0, Z1, BAYS + 1)
    xm = (X0 + X1) / 2
    for i, (za, zb) in enumerate(zip(levels[:-1], levels[1:])):
        for xa, xb in ((X0, xm), (xm, X1)) if detailed else ((X0, X1),):
            tone = MESH * rng.uniform(0.95, 1.04)
            # Slightly darker toward the middle of each sheet, lighter where it is welded to the frame.
            k.add([(xa, 0, za), (xb, 0, za), (xb, 0, zb), (xa, 0, zb), ((xa + xb) / 2, 0, (za + zb) / 2)], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], [tone * 1.05] * 4 + [tone * 0.93])
    for i, z in enumerate(levels):
        if 0 < i < BAYS:
            k.beam((X0, 0, z), (X1, 0, z), 0.16, PAINT * 0.97, h=0.34, sides=4 if detailed else 3, cap=False)
        if detailed:
            # Band bracket clamping the frame to the pole.
            r = radius(z)
            k.lathe([(r + 0.07, z - 0.22), (r + 0.07, z + 0.22)], 10, lambda rr, zz, a: PAINT * (0.86 + 0.08 * math.cos(a)), cap_ends=False)
            k.beam((r * 0.9, 0, z), (X0 + 0.1, 0, z), 0.3, PAINT * 0.9, h=0.5, sides=4, cap=False)
    if detailed:
        k.beam((xm, 0, Z0), (xm, 0, Z1), 0.12, PAINT * 0.97, h=0.3, sides=4, cap=False)
    # Knee brace under the outer corner.
    zk = Z0 - 5.5
    k.beam((radius(zk) * 0.8, 0, zk), (X1 - 0.1, 0, Z0), 0.2, PAINT * 0.95, sides=sides, cap=False)
    if detailed:
        k.lathe([(radius(zk) + 0.07, zk - 0.25), (radius(zk) + 0.07, zk + 0.25)], 10, lambda rr, zz, a: PAINT * 0.88, cap_ends=False)
    return k


def build():
    mat = materials.pbr("foul_pole", roughness=0.5)
    objs = []
    for i, detailed in enumerate([True, False]):
        ob = build_lod(detailed).object(f"foul_pole_LOD{i}", smooth=True)
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
