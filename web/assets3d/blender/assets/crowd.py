"""
Crowd sprite atlas: 48 fans modelled waist-up (sculpted heads with brows, nose, ears and
jaw, hair, caps, sunglasses, beards; lofted torsos; jointed arms and hands), each lit
and rendered with Cycles into one 128 × 170 cell of a 1024² atlas laid out as
parks/textures.ts CROWD: 8 × 6 cells, the first 40 seated, the last 8 cheering. The asset
itself is a single quad carrying the atlas as its base-colour image; the web crowd reads
the image off it.

The atlas follows the shader's conventions (Ballpark.tsx Crowd):
* clothes are neutral greys (each fan's tint multiplies them);
* team trim — jersey wordmark, number, placket and piping, tee logos, stripes, caps — is
  the magenta marker (R = B, G = 0), which the shader swaps for the fan's second colour;
* skin and hair keep their colour;
* a cell's outfit style is its index mod 4 (0 jersey, 1 tee, 2 hoodie, 3 plain/striped);
* transparent texels carry the cell's mean colour, so mipmapped fans blur into soft
  blobs rather than dark-fringed specks.
"""
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np

from wtbb3d import kit, materials, scene

SPEC = {
    "name": "crowd",
    "description": "Crowd sprite atlas (48 Cycles-rendered fans, 8 × 6 cells of 128 × 170) on a quad",
    "lods": [2],
    "max_texture": 1024,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

COLS, ROWS, CW, CH, SIZE, SEATED = 8, 6, 128, 170, 1024, 40
PX = 0.0186  # feet per pixel: the card is 2.3 × 3.05 ft over 0.95 × 166/170 of a cell
TILT = math.radians(11)  # the camera looks down a little, as from the field at the stands
STYLES = 4  # jersey, tee, hoodie, plain


def lin(h: str) -> np.ndarray:
    c = np.array([int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb_lin(v: float) -> float:
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


SKINS = [lin(h) for h in ("#f1cdb0", "#e6bb98", "#d4a27a", "#b98257", "#8f5e3c", "#6a4329", "#4e301d")]
HAIRS = [lin(h) for h in ("#1f1712", "#2b1e16", "#45301f", "#6a472a", "#9a7442", "#cfae6c", "#7f4126", "#bdb5a6", "#352820")]
MARK = np.array([0.56, 0.0, 0.56])  # magenta marker, ≈ sRGB 0.77 when lit face-on
EYE = np.array([0.025, 0.02, 0.018])
LIPS = np.array([0.30, 0.10, 0.09])


# ---------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------
def vc_material(name: str, rough: float, sss: float = 0.0, sheen: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Color"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if sss:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        bsdf.inputs["Subsurface Scale"].default_value = 0.02
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    return mat


def torso_material(name: str, mask: bpy.types.Image, box) -> bpy.types.Material:
    """Vertex-colour cloth, with trim (mask R → marker) and darker panels (mask G) projected from the front."""
    x0, z0, span = box
    mat = vc_material(name, 0.86, sheen=0.35)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = next(n for n in nt.nodes if n.type == "ATTRIBUTE")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    u = nt.nodes.new("ShaderNodeMath")
    u.operation = "MULTIPLY_ADD"
    u.inputs[1].default_value = 1 / span
    u.inputs[2].default_value = -x0 / span
    nt.links.new(sep.outputs["X"], u.inputs[0])
    v = nt.nodes.new("ShaderNodeMath")
    v.operation = "MULTIPLY_ADD"
    v.inputs[1].default_value = 1 / span
    v.inputs[2].default_value = -z0 / span
    nt.links.new(sep.outputs["Z"], v.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u.outputs[0], comb.inputs["X"])
    nt.links.new(v.outputs[0], comb.inputs["Y"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = mask
    tex.extension = "CLIP"
    tex.interpolation = "Cubic"
    nt.links.new(comb.outputs["Vector"], tex.inputs["Vector"])
    msep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], msep.inputs["Color"])
    # Darker panels: cloth × (1 − 0.45 G).
    dk = nt.nodes.new("ShaderNodeMix")
    dk.data_type = "RGBA"
    dk.blend_type = "MULTIPLY"
    dk.inputs["B"].default_value = (0.55, 0.55, 0.55, 1.0)
    nt.links.new(msep.outputs["Green"], dk.inputs["Factor"])
    nt.links.new(attr.outputs["Color"], dk.inputs["A"])
    tr = nt.nodes.new("ShaderNodeMix")
    tr.data_type = "RGBA"
    tr.inputs["B"].default_value = (*MARK, 1.0)
    nt.links.new(msep.outputs["Red"], tr.inputs["Factor"])
    nt.links.new(dk.outputs["Result"], tr.inputs["A"])
    nt.links.new(tr.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


# ---------------------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------------------
def loft(rows, seg: int, color_fn, cap_top: bool = False):
    """
    Rings of a rounded rectangle (superellipse) at each row (z, rx, ry, cy, power), front
    (−Y) first. Returns verts, faces, colours.
    """
    verts, cols, faces = [], [], []
    for i, (z, rx, ry, cy, pw) in enumerate(rows):
        for j in range(seg):
            a = 2 * math.pi * j / seg
            s, c = math.sin(a), -math.cos(a)  # a = 0 faces the camera (−Y)
            e = 2 / pw
            x = rx * math.copysign(abs(s) ** e, s)
            y = cy + ry * math.copysign(abs(c) ** e, c)
            p = np.array([x, y, z])
            verts.append(p)
            cols.append(color_fn(p, i, a))
    for i in range(len(rows) - 1):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    if cap_top:
        faces.append(tuple((len(rows) - 1) * seg + j for j in range(seg)))
    return verts, faces, cols


def path(points, n: int) -> np.ndarray:
    """A smooth curve through three or four control points (quadratic/cubic Bézier)."""
    P = np.asarray(points, float)
    t = np.linspace(0, 1, n)[:, None]
    if len(P) == 3:
        return (1 - t) ** 2 * P[0] + 2 * (1 - t) * t * P[1] + t**2 * P[2]
    return (1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t**2 * P[2] + t**3 * P[3]


def head_mesh(k: kit.Kit, centre, rng, skin, f):
    """
    A head from a subdivided sphere: egg-shaped skull, tapering jaw and chin, brow, nose,
    cheekbones, eye sockets with dark eyes, lips. ``f`` carries the face options. Returns
    a function mapping a head-local point to world space (for hair, caps, glasses).
    """
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0)
    V = np.array([v.co[:] for v in bm.verts])
    F = [[v.index for v in fc.verts] for fc in bm.faces]
    bm.free()
    rx, ry, rz = f["rx"], f["ry"], f["rz"]
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    front = np.clip(-y, 0, 1)
    # Jaw: narrower and flatter below the cheekbones, a squarer chin for some.
    jaw = np.clip(-z, 0, 1)
    sx = 1 - (0.30 - 0.1 * f["square"]) * jaw**1.6
    sy = 1 - 0.18 * jaw**2
    P = np.stack([x * rx * sx, y * ry * sy, z * rz], axis=1)
    P[:, 1] -= 0.03 * front**2  # flatter face plane pulled forward a touch
    g = lambda cx, cz, wx, wz: np.exp(-(((P[:, 0] - cx) / wx) ** 2) - ((P[:, 2] - cz) / wz) ** 2) * front**3  # noqa: E731
    out = np.zeros(len(P))
    out += 0.075 * g(0.0, -0.06, 0.035, 0.09)  # nose
    out += 0.03 * g(0.0, -0.13, 0.05, 0.03)  # nose tip / nostrils
    out += 0.03 * g(0.0, 0.07, 0.17, 0.035)  # brow ridge
    out -= 0.035 * (g(-0.095, 0.02, 0.055, 0.035) + g(0.095, 0.02, 0.055, 0.035))  # eye sockets
    out += 0.02 * (g(-0.15, -0.04, 0.06, 0.05) + g(0.15, -0.04, 0.06, 0.05))  # cheekbones
    out += 0.022 * g(0.0, -0.205, 0.05, 0.025)  # lips
    out += 0.03 * g(0.0, -0.31, 0.06, 0.04) * (0.6 + f["square"])  # chin
    if f["open"]:
        out -= 0.05 * g(0.0, -0.215, 0.05, 0.04)  # open mouth (cheering)
    P[:, 1] -= out
    # Colours.
    cols = np.tile(skin, (len(P), 1))
    cols *= (1 - 0.18 * np.clip(-P[:, 2] / rz - 0.75, 0, 1))[:, None]  # under the jaw
    mouth_w = 0.055 if f["open"] else 0.06
    lip = g(0.0, -0.205, mouth_w, 0.02 if not f["open"] else 0.035)
    lipcol = np.array([0.08, 0.02, 0.02]) if f["open"] else LIPS * (skin.mean() / 0.35) ** 0.5
    cols = cols * (1 - 0.75 * lip[:, None]) + lipcol * 0.75 * lip[:, None]
    cheek = g(-0.13, -0.08, 0.06, 0.05) + g(0.13, -0.08, 0.06, 0.05)
    cols *= 1 + 0.08 * cheek[:, None] * np.array([1.0, -0.4, -0.5])
    if f["beard"]:
        b = np.clip((-P[:, 2] / rz - 0.15) * 3, 0, 1) * np.clip((-P[:, 1] / ry + 0.25) * 2, 0, 1)
        b *= 1 - lip * 0.6
        b = np.clip(b * f["beard"], 0, 1)
        cols = cols * (1 - b[:, None]) + f["hair"] * 1.1 * b[:, None]
    if f["brows"]:
        br = g(-0.09, 0.085, 0.05, 0.013) + g(0.09, 0.085, 0.05, 0.013)
        br = np.clip(br * 1.5, 0, 1)
        cols = cols * (1 - 0.7 * br[:, None]) + f["hair"] * 0.7 * br[:, None]
    yaw, pitch = f["yaw"], f["pitch"]
    cy, sy_, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    Ry = np.array([[cy, -sy_, 0], [sy_, cy, 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    R = Ry @ Rx
    c = np.asarray(centre, float)
    to_world = lambda p: np.asarray(p, float) @ R.T + c  # noqa: E731
    k.add(to_world(P), F, cols)
    # Ears.
    for sd in (-1, 1):
        ear_c = np.array([sd * rx * 0.97, 0.03, -0.03])
        k.blob(to_world(ear_c), 0.055, lambda p, n: skin * 0.88, rng, subdiv=2, rough=0.05, squash=(0.45, 0.9, 1.35))
    return to_world, R, P


# ---------------------------------------------------------------------------------------
# One fan
# ---------------------------------------------------------------------------------------
def fan_params(i: int, rng) -> dict:
    female = rng.random() < 0.42
    heavy = (not female and rng.random() < 0.22) or (female and rng.random() < 0.12)
    light = rng.random() < 0.6
    L = rng.uniform(0.76, 0.95) if light else rng.uniform(0.3, 0.55)
    p = {
        "i": i,
        "style": i % STYLES,
        "cheer": i >= SEATED,
        "female": female,
        "heavy": heavy,
        "grey": min(0.92, srgb_lin(L) * 1.12),
        "skin": SKINS[rng.integers(len(SKINS))] * rng.uniform(0.94, 1.05),
        "hair": HAIRS[rng.integers(len(HAIRS))],
        "cap": rng.random() < 0.36,
        "shades": rng.random() < 0.26,
        "long_sleeve": rng.random() < 0.3,
        "beard": (not female) and rng.random() < 0.3,
        "hair_style": rng.random(),
        "dx": rng.uniform(-0.05, 0.05),
        "drink": rng.random(),
        "pose": rng.random(),
        "stripes": rng.random() < 0.4,
        "letters": int(rng.integers(5, 8)),
        "number": int(rng.integers(1, 99)),
        "seed": int(rng.integers(1 << 30)),
    }
    if p["style"] == 2:
        p["long_sleeve"] = True
    if p["hair"][0] > 0.4 and rng.random() < 0.5:  # grey and blond hair: rarer among the young-looking
        p["hair"] = HAIRS[rng.integers(4)]
    return p


def paint_mask(p: dict, box, n: int = 512) -> np.ndarray:
    """Trim (R) and dark panels (G) for the torso, front-projected: x ∈ [x0, x0+span], z ∈ [z0, z0+span]."""
    x0, z0, span = box
    img = np.zeros((n, n, 4), np.float32)
    img[..., 3] = 1.0
    X = x0 + (np.arange(n) + 0.5) / n * span
    Z = z0 + (np.arange(n) + 0.5) / n * span
    XX, ZZ = np.meshgrid(X, Z)  # row 0 = bottom (Blender order)
    rng = np.random.default_rng(p["seed"])

    def rect(xa, xb, za, zb, ch=0, val=1.0, slant=0.0):
        xs = XX - slant * (ZZ - za)
        m = (xs >= xa) & (xs <= xb) & (ZZ >= za) & (ZZ <= zb)
        img[..., ch][m] = np.maximum(img[..., ch][m], val)

    def ellipse(cx, cz, ax, az, ch=0, val=1.0, inner=0.0):
        r = ((XX - cx) / ax) ** 2 + ((ZZ - cz) / az) ** 2
        m = (r <= 1.0) & (r >= inner**2)
        img[..., ch][m] = np.maximum(img[..., ch][m], val)

    w = 0.88 if p["female"] else 1.0
    st = p["style"]
    if st == 0:
        # Jersey: placket, piping over the yoke, a script wordmark across the chest, a number.
        rect(-0.022, 0.022, 0.1, 1.58)
        rect(-0.6, 0.6, 1.36, 1.395)
        n_l = p["letters"]
        width = 0.78 * w
        xs = np.linspace(-width / 2, width / 2, n_l + 1)
        base = 1.02
        for j in range(n_l):
            h = 0.12 if j == 0 else rng.uniform(0.06, 0.09)
            lift = 0.05 * (j / n_l)  # wordmarks rise to the right
            a, b = xs[j] + 0.012, xs[j + 1] - 0.012
            rect(a, b, base + lift, base + lift + h, slant=0.25)
            if rng.random() < 0.5:  # counters and gaps make it read as lettering
                rect(a + (b - a) * 0.35, a + (b - a) * 0.65, base + lift + h * 0.3, base + lift + h * 0.7, val=0.0, slant=0.25)
        rect(-width / 2, width / 2 + 0.05, base - 0.06, base - 0.035, slant=0.0)  # tail swash
        # Number on the wearer's left belly (viewer's right).
        digits = str(p["number"])
        for d, ch in enumerate(digits):
            cx = 0.2 + d * 0.11 - (len(digits) - 1) * 0.055
            rect(cx - 0.04, cx + 0.04, 0.55, 0.72)
            if ch not in "17":
                rect(cx - 0.015, cx + 0.015, 0.6, 0.67, val=0.0)
        # Side panels darker.
    elif st == 1:
        # Tee: a big chest logo — a disc, a ring and a mark inside.
        cz = 1.0
        ellipse(0.0, cz, 0.27 * w, 0.2)
        ellipse(0.0, cz, 0.22 * w, 0.155, val=0.0)
        ellipse(0.0, cz, 0.2 * w, 0.14, inner=0.0)
        rect(-0.09, 0.09, cz - 0.03, cz + 0.03, val=0.0)
        rect(-0.15 * w, 0.15 * w, cz - 0.27, cz - 0.23)  # a line of text under it
    elif st == 2:
        # Hoodie: zip, kangaroo pocket or jacket hem in a darker shade, small chest logo.
        rect(-0.012, 0.012, 0.0, 1.5, ch=1)
        if rng.random() < 0.5:
            rect(-0.32 * w, 0.32 * w, 0.18, 0.5, ch=1, val=0.55)
        else:
            rect(-1, 1, -0.4, 0.22, ch=1, val=0.6)
        ellipse(0.26 * w, 1.12, 0.055, 0.055)
    elif p["stripes"]:
        for zz in np.arange(-0.2, 1.4, 0.24):
            rect(-1.2, 1.2, zz, zz + 0.085, val=0.95)
    return img


def build_fan(p: dict, mats: dict) -> list:
    rng = np.random.default_rng(p["seed"])
    skin, hair = p["skin"], p["hair"]
    grey = np.full(3, p["grey"])
    fem, heavy = p["female"], p["heavy"]
    wid = (0.88 if fem else 1.0) * (1.12 if heavy else 1.0)
    dep = (1.0 if not fem else 0.94) * (1.3 if heavy else 1.0)
    dx = p["dx"]

    def cloth(pos, i, a, k=1.0):
        # Folds: soft horizontal wrinkles, a darker underside toward the waist.
        fold = 1 + 0.06 * math.sin(pos[2] * 23 + 3 * math.sin(a * 2 + p["seed"] % 7)) * math.cos(a)
        return grey * k * fold

    # -- torso ---------------------------------------------------------------------------
    rows = [
        (-0.6, 0.56 * wid, 0.38 * dep, 0.0, 3.0),
        (0.0, 0.53 * wid, 0.36 * dep, 0.0, 3.0),
        (0.45, (0.53 if not heavy else 0.6) * wid, (0.36 if not heavy else 0.46) * dep, -0.02 if heavy else 0.0, 3.0),
        (0.85, 0.58 * wid, 0.37 * dep, 0.0, 3.2),
        (1.12, 0.62 * wid, (0.38 if not fem else 0.41) * dep, -0.03 if fem else 0.0, 3.4),
        (1.32, 0.64 * wid, 0.33 * dep, 0.0, 3.6),
        (1.43, 0.6 * wid, 0.27 * dep, 0.01, 3.4),
        (1.5, 0.45 * wid, 0.22, 0.02, 2.6),
        (1.56, 0.26, 0.19, 0.02, 2.2),
        (1.6, 0.19, 0.16, 0.02, 2.0),
    ]
    rows = [(z, rx, ry, cy, pw) for z, rx, ry, cy, pw in rows]
    tk = kit.Kit()
    v, f, c = loft(rows, 64, cloth, cap_top=True)
    tk.add(np.array(v) + [dx, 0, 0], f, c)
    if p["style"] == 2:
        # Hood bunched behind the neck.
        tk.blob((dx, 0.2, 1.62), 0.3, lambda q, n: grey * 0.85, rng, subdiv=3, rough=0.08, squash=(1.1, 0.6, 0.55))
    torso = tk.object(f"fan_torso_{p['i']}", smooth=True)
    box = (-1.2, -0.7, 2.4)
    mask = materials.image_from_array(f"fan_mask_{p['i']}", paint_mask(p, box), non_color=True)
    tmat = torso_material(f"fan_cloth_{p['i']}", mask, (box[0] + dx, box[1], box[2]))
    # The mask is painted around the fan's own centre: shift its frame by dx.
    materials.assign(torso, tmat)

    ck = kit.Kit()  # other cloth (sleeves, collar): vertex colour only
    sk = kit.Kit()  # skin
    hk = kit.Kit()  # hair
    mk = kit.Kit()  # marker (caps), shiny bits

    # Neck and collar.
    neck_top = 1.92
    sk.tube([(dx, 0.0, 1.4), (dx, -0.01, 1.7), (dx, 0.0, neck_top)], [0.17, 0.16, 0.15], 20, lambda i, a, q: skin * (0.82 + 0.1 * (q[2] - 1.4)))
    if p["style"] in (1, 3):
        ck.tube([(dx, 0.02, 1.58), (dx, 0.02, 1.64)], [0.205, 0.2], 28, lambda i, a, q: grey * 0.9, cap=False)
    elif p["style"] == 0:
        ck.tube([(dx, 0.02, 1.57), (dx, 0.0, 1.63)], [0.21, 0.205], 28, lambda i, a, q: MARK if i == 1 else grey, cap=False)

    # -- head ----------------------------------------------------------------------------
    s = 0.95 if fem else 1.0
    face = {
        "rx": 0.255 * s,
        "ry": 0.3 * s,
        "rz": 0.355 * s,
        "square": 0.0 if fem else rng.uniform(0.2, 1.0),
        "open": p["cheer"],
        "beard": rng.uniform(0.5, 1.0) if p["beard"] else 0.0,
        "brows": True,
        "hair": hair,
        "yaw": rng.uniform(-0.3, 0.3),
        "pitch": rng.uniform(-0.2, -0.05) if p["cheer"] else rng.uniform(-0.05, 0.12),
    }
    hc = np.array([dx, -0.02, neck_top + 0.2])
    to_world, R, Phead = head_mesh(sk, hc, rng, skin, face)
    rx, ry, rz = face["rx"], face["ry"], face["rz"]
    # Eyes (or sunglasses).
    if p["shades"]:
        for sd in (-1, 1):
            g = [to_world((sd * 0.095 + sd * u * 0.065, -ry * 1.0 - 0.01, 0.015 + w)) for u, w in ((-1, 0.03), (1, 0.03), (1, -0.04), (-1, -0.035))]
            mk.plate(g, np.array([0.01, 0.012, 0.015]))
        mk.beam(to_world((-0.17, -ry * 0.98, 0.04)), to_world((0.17, -ry * 0.98, 0.04)), 0.015, np.array([0.01, 0.01, 0.01]), sides=4)
    else:
        for sd in (-1, 1):
            # Sit the eye on the socket's surface: the frontmost head vertex there.
            near = Phead[(np.abs(Phead[:, 0] - sd * 0.093) < 0.02) & (np.abs(Phead[:, 2] - 0.018) < 0.02)]
            ey = near[:, 1].min() + 0.012 if len(near) else -ry
            mk.blob(to_world((sd * 0.093, ey, 0.018)), 0.03, lambda q, n: EYE, rng, subdiv=2, rough=0.0, squash=(1.25, 0.5, 0.7))
    # Hair: a shell over the skull, the hairline set back over the brow; long hair falls behind.
    hs = p["hair_style"]
    bald = (not fem) and hs > 0.93 and not p["cap"]
    if not bald and not p["cap"]:
        sel = []
        line_front = 0.2 if not fem else 0.16
        for q in Phead:
            ang = math.atan2(q[0], -q[1])  # 0 = front
            fr = max(0.0, math.cos(ang))
            need = line_front * fr + (-0.06 if fem else 0.02) * (1 - fr) - 0.1 * max(0.0, -math.cos(ang))
            sel.append(q[2] / rz > need / rz)
        # Shell vertices: pushed out along the radial direction.
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        HV = np.array([vv.co[:] for vv in bm.verts])
        HF = [[vv.index for vv in fc.verts] for fc in bm.faces]
        bm.free()
        thick = 0.03 if not fem else 0.045
        HP = HV * np.array([rx + thick, ry + thick, rz + thick])
        HP[:, 2] += 0.01
        keep = []
        for fc in HF:
            m = HP[fc].mean(axis=0)
            ang = math.atan2(m[0], -m[1])
            fr = max(0.0, math.cos(ang))
            need = line_front * fr + (-0.05 if fem else 0.0) * (1 - fr) - 0.16 * max(0.0, -math.cos(ang))
            ear = abs(m[0]) > rx * 0.8 and -0.12 < m[2] < 0.08 and fr < 0.6 and not fem
            if m[2] > need and not ear:
                keep.append(fc)
        used = sorted({ii for fc in keep for ii in fc})
        remap = {o: n for n, o in enumerate(used)}
        hcol = [hair * (0.85 + 0.3 * rng.random()) for _ in used]
        hk.add(to_world(HP[used]), [[remap[ii] for ii in fc] for fc in keep], hcol)
    if not bald and fem:
        if hs < 0.72:
            # Long hair: a curtain from the crown down behind the shoulders.
            length = rng.uniform(0.55, 0.95)
            prof = []
            for t in np.linspace(0, 1, 10):
                z = 0.15 - t * (0.45 + length)
                w_ = rx + 0.06 + 0.12 * math.sin(min(1.0, t * 1.6) * math.pi / 2)
                prof.append((z, w_, ry * 0.75 + 0.05 * t, 0.12 + 0.12 * t, 2.4))
            lv, lf, lc = loft(prof, 32, lambda q, i, a: hair * (0.75 + 0.25 * math.cos(a * 3 + i)))
            # Keep only the back and sides so the face stays clear.
            lv = np.array(lv)
            keepf = [fc for fc in lf if (lv[list(fc)][:, 1].mean() > -ry * 0.25)]
            hk.add(to_world(lv), keepf, lc)
        elif hs < 0.9 and not p["cap"]:
            hk.blob(to_world((0, ry * 0.95, 0.12)), 0.12, lambda q, n: hair * 0.9, rng, subdiv=2, rough=0.15, squash=(1, 0.8, 1))  # bun
    # Cap: crown, button and brim in the marker.
    if p["cap"]:
        crown = []
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        CV = np.array([vv.co[:] for vv in bm.verts])
        CF = [[vv.index for vv in fc.verts] for fc in bm.faces]
        bm.free()
        CP = CV * np.array([rx + 0.04, ry + 0.04, rz + 0.03])
        CP[:, 2] += 0.02
        keep = [fc for fc in CF if CP[fc].mean(axis=0)[2] > 0.13 - 0.06 * (CP[fc].mean(axis=0)[1] > 0)]
        used = sorted({ii for fc in keep for ii in fc})
        remap = {o: n for n, o in enumerate(used)}
        crown = [MARK * (0.82 + 0.18 * (CP[ii][2] / rz)) * (0.93 + 0.07 * math.cos(6 * math.atan2(CP[ii][0], CP[ii][1]))) for ii in used]  # panel seams
        mk.add(to_world(CP[used]), [[remap[ii] for ii in fc] for fc in keep], crown)
        mk.blob(to_world((0, 0, rz + 0.05)), 0.03, lambda q, n: MARK, rng, subdiv=1, rough=0.0)
        brim = []
        bz = 0.15
        for u in np.linspace(-1, 1, 9):
            a = u * 1.15
            inner = (math.sin(a) * (rx + 0.04), -math.cos(a) * (ry + 0.03), bz)
            outer = (math.sin(a) * (rx + 0.06) * 1.05, -math.cos(a) * (ry + 0.03) - 0.24 * math.cos(u * math.pi / 2) ** 0.7, bz - 0.04 - 0.02 * (1 - abs(u)))
            brim.append((inner, outer))
        for (i0, o0), (i1, o1) in zip(brim[:-1], brim[1:]):
            mk.plate([to_world(i0), to_world(i1), to_world(o1), to_world(o0)], MARK * 0.8)

    # -- arms ------------------------------------------------------------------------------
    sh_x = 0.6 * wid
    sleeve_len = 1.0 if p["long_sleeve"] else 0.42
    for sd in (-1, 1):
        sh = np.array([dx + sd * (sh_x - 0.1), 0.0, 1.38])
        pose = p["pose"]
        if p["cheer"]:
            if pose < 0.5 or (pose < 0.75 and sd == 1):
                # Arms up in a V.
                el = sh + np.array([sd * 0.28, -0.05, 0.48])
                wr = el + np.array([sd * rng.uniform(0.0, 0.18), -0.06, 0.52])
                fist = True
            elif pose < 0.75:
                el = sh + np.array([sd * 0.1, -0.05, -0.55])
                wr = el + np.array([-sd * 0.08, -0.5, 0.05])
                fist = False
            else:
                # Clapping in front of the chin.
                el = sh + np.array([sd * 0.2, -0.3, -0.45])
                wr = np.array([dx + sd * 0.07, -0.72, 1.62])
                fist = False
        else:
            drink = p["drink"] < 0.18 and sd == (1 if p["seed"] % 2 else -1)
            if drink:
                el = sh + np.array([sd * 0.08, -0.05, -0.62])
                wr = np.array([dx + sd * 0.3, -0.62, 0.95])
            elif pose < 0.2:
                # Arms folded.
                el = sh + np.array([sd * 0.1, -0.08, -0.62])
                wr = np.array([dx - sd * 0.25, -0.5, 0.62])
            else:
                el = sh + np.array([sd * 0.14, -0.02, -0.7])
                wr = el + np.array([-sd * 0.05, -0.36, -0.62])
            fist = drink
        upper = path([sh, (sh + el) / 2 + np.array([sd * 0.03, 0, 0]), el], 7)
        lower = path([el, (el + wr) / 2, wr], 7)
        arm = np.concatenate([upper, lower[1:]])
        radii = np.concatenate([np.linspace(0.19, 0.135, 7), np.linspace(0.13, 0.09, 7)[1:]]) * (1.1 if heavy else 1.0) * (0.92 if fem else 1.0)
        n_sl = int(round(sleeve_len * (len(arm) - 1))) + 1
        n_sl = max(3, min(len(arm), n_sl))
        sleeve_col = lambda i, a, q, n=n_sl: (MARK if (p["style"] == 0 and i >= n - 2 and not p["long_sleeve"]) else grey * (0.9 + 0.08 * math.cos(a)))  # noqa: E731
        ck.tube(arm[:n_sl], radii[:n_sl] + 0.025, 16, sleeve_col, cap=True)
        if n_sl < len(arm):
            sk.tube(arm[n_sl - 2 :], radii[n_sl - 2 :], 14, lambda i, a, q: skin * 0.92, cap=True)
        # Hand.
        d = wr - arm[-2]
        d /= np.linalg.norm(d)
        hand = wr + d * 0.09
        sk.blob(hand, 0.085 if fist else 0.09, lambda q, n: skin * 0.95, rng, subdiv=2, rough=0.08, squash=(0.9, 0.75, 1.15) if not fist else (1, 1, 1))
        if not p["cheer"] and p["drink"] < 0.18 and sd == (1 if p["seed"] % 2 else -1):
            cup = np.array([0.72, 0.1, 0.08]) if p["seed"] % 3 else np.array([0.85, 0.82, 0.72])
            mk.beam(hand + np.array([0, -0.05, -0.12]), hand + np.array([0, -0.05, 0.3]), 0.2, cup, sides=12, w1=0.24)

    objs = [torso]
    for name, kk, mat in (("cloth", ck, mats["cloth"]), ("skin", sk, mats["skin"]), ("hair", hk, mats["hair"]), ("mark", mk, mats["mark"])):
        if kk.v:
            ob = kk.object(f"fan_{name}_{p['i']}", smooth=True)
            materials.assign(ob, mat)
            objs.append(ob)
    return objs


# ---------------------------------------------------------------------------------------
# Render and compose
# ---------------------------------------------------------------------------------------
def setup_render() -> bpy.types.Object:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.cycles.seed = 7
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = CW, CH
    sc.render.resolution_percentage = 100
    sc.render.filter_size = 1.2
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    world = bpy.data.worlds.new("crowd_sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.41, 0.42, 0.44, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.0
    sun.data.angle = math.radians(12)
    # Light from above, a little in front and to the left of the camera.
    d = np.array([0.3, 0.75, -0.6])
    d /= np.linalg.norm(d)
    sun.rotation_euler = (np.array([0, 0, -1.0]) * 0).tolist()
    sun.rotation_mode = "QUATERNION"
    from mathutils import Vector

    sun.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(Vector(d.tolist()))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = CH * PX
    sc.collection.objects.link(cam)
    sc.camera = cam
    # Looking along +Y, pitched down by TILT; the cell centre (85 px up) on the optical axis.
    fwd = np.array([0, math.cos(TILT), -math.sin(TILT)])
    up = np.array([0, math.sin(TILT), math.cos(TILT)])
    pos = -30 * fwd + up * (CH / 2) * PX
    cam.location = pos.tolist()
    cam.rotation_euler = (math.pi / 2 - TILT, 0, 0)
    return cam


def render_cell(path_: str) -> np.ndarray:
    sc = bpy.context.scene
    sc.render.filepath = path_
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path_)
    px = np.array(img.pixels[:], np.float32).reshape(CH, CW, 4)  # row 0 = bottom
    bpy.data.images.remove(img)
    return px[::-1]  # top-down


def compose(cells: list[np.ndarray]) -> np.ndarray:
    A = np.zeros((SIZE, SIZE, 4), np.float32)
    for i, cell in enumerate(cells):
        x0, y0 = (i % COLS) * CW, (i // COLS) * CH
        c = cell.copy()
        clip = np.zeros((CH, CW), bool)
        clip[2 : CH - 1, 2 : CW - 2] = True
        c[~clip] = 0
        solid = c[..., 3] > 200 / 255
        mean = c[solid][:, :3].mean(axis=0) if solid.any() else np.full(3, 0.5)
        clear = c[..., 3] < 10 / 255
        c[clear, :3] = mean
        c[clear, 3] = 0
        A[y0 : y0 + CH, x0 : x0 + CW] = c
    # Unused strip below the last row: the overall mean.
    used = A[: ROWS * CH]
    A[ROWS * CH :, :, :3] = used[..., :3].reshape(-1, 3).mean(axis=0)
    return A


def build():
    mats = {
        "cloth": vc_material("fan_cloth", 0.88, sheen=0.35),
        "skin": vc_material("fan_skin", 0.5, sss=0.25),
        "hair": vc_material("fan_hair", 0.55, sheen=0.2),
        "mark": vc_material("fan_mark", 0.45),
    }
    setup_render()
    rng = np.random.default_rng(1906)
    tmp = tempfile.mkdtemp(prefix="crowd_")
    cells = []
    for i in range(COLS * ROWS):
        p = fan_params(i, rng)
        objs = build_fan(p, mats)
        cells.append(render_cell(os.path.join(tmp, f"cell_{i:02d}.png")))
        for o in objs:
            me = o.data
            bpy.data.objects.remove(o)
            bpy.data.meshes.remove(me)
    atlas = compose(cells)
    for o in list(bpy.data.objects):
        if o.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(o)
    img = materials.image_from_array("crowd_atlas", atlas[::-1].copy())
    if os.environ.get("CROWD_DEBUG"):
        img.filepath_raw = os.environ["CROWD_DEBUG"]
        img.file_format = "PNG"
        img.save()
    mat = materials.pbr("crowd", base_image=img, roughness=1.0)
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    v = np.array([[-0.5, 0, 0], [0.5, 0, 0], [0.5, 0, 1], [-0.5, 0, 1]], float)
    uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
    ob = scene.mesh_object("crowd_LOD0", v, [(0, 1, 2, 3)], uvs=uv, smooth=False)
    materials.assign(ob, mat)
    bpy.context.view_layer.update()
    return [ob]
