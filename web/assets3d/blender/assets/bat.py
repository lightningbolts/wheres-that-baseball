"""
The bat (replaces the lathe in components/game/scene/character/bat.ts, same contract):
handle at the origin, barrel along three.js +Y (Blender +Z), feet. A 34-inch bat, 2.82 ft
knob to end, 2.6-inch barrel, cupped end.

What Blender adds over the runtime lathe:
- a smoothed profile (Catmull-Rom through the same control points) at LOD0;
- real wood grain: flat-sawn planes cut by the round surface (long streaks on the handle,
  cathedral ovals on the barrel) with pores, baked from procedural nodes in Cycles;
- a roughness map: tacky pine tar on the handle, lacquered barrel, a rubbed knob.

The finish greys (pine tar, maker's rings, dark cup) stay in vertex colours, and the
per-bat instance colour multiplies everything, so ash / maple / black bats still work.
"""
import numpy as np

from wtbb3d import bake, materials, scene

SPEC = {
    "name": "bat",
    "description": "34-inch wood bat: handle at origin, barrel along +Y, feet",
    "lods": [2400, 600],
    "max_texture": 1024,
    # Ash, linear: what BAT_COLORS[0] tints it at runtime. Preview only.
    "preview_tint": (0.64, 0.42, 0.18),
}

# [radius, height] (ft), copied from bat.ts so the silhouette and grip point match.
PROFILE = [
    (0, -0.2), (0.05, -0.2), (0.078, -0.192), (0.085, -0.175), (0.08, -0.158), (0.058, -0.14),
    (0.044, -0.115), (0.04, -0.05), (0.04, 0.3), (0.042, 0.6), (0.047, 0.9), (0.056, 1.15),
    (0.07, 1.4), (0.086, 1.65), (0.099, 1.9), (0.107, 2.15), (0.108, 2.4), (0.106, 2.52),
    (0.098, 2.585), (0.082, 2.615), (0.06, 2.62), (0.045, 2.6), (0, 2.585),
]
TEX_W, TEX_H = 128, 1024


def smoothed(profile, steps: int):
    """Catmull-Rom through the control points; the end points (on the axis) stay exact."""
    p = np.asarray(profile, dtype=np.float64)
    out = [tuple(p[0])]
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = p[max(i - 1, 0)], p[i], p[i + 1], p[min(i + 2, len(p) - 1)]
        for k in range(1, steps + 1):
            t = k / steps
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
            # Rows on the axis must stay on it (they become pole vertices).
            r = 0.0 if (k == steps and p2[0] == 0) else max(q[0], 0.002)
            out.append((r, q[1]))
    return out


def _smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def finish(r: float, z: float, a: float) -> float:
    """Same finish greys as bat.ts (pine tar, rubbed knob, maker's rings, dark cup)."""
    k = 1 - (0.42 + 0.1 * np.sin(a * 2)) * _smooth(0.95, 0.15, z) * _smooth(-0.16, -0.08, z)
    if z < -0.15:
        k = 1.0
    if 1.36 < z < 1.44 or 1.6 < z < 1.7:
        k *= 0.55
    if z > 2.59 and r < 0.07:
        k *= 0.6
    return k


def grain_nodes(nt):
    """Flat-sawn grain: wave bands across object X, wobbled by noise, plus fine pores."""
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 0.08)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 55.0
    wave.inputs["Distortion"].default_value = 5.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.4
    nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.74, 0.74, 0.74, 1)
    ramp.color_ramp.elements[1].position = 0.9
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    pores = nt.nodes.new("ShaderNodeTexNoise")
    pores.inputs["Scale"].default_value = 900.0
    pores.inputs["Detail"].default_value = 1.0
    nt.links.new(coord.outputs["Object"], pores.inputs["Vector"])
    pr = nt.nodes.new("ShaderNodeMapRange")
    pr.inputs["From Min"].default_value = 0.35
    pr.inputs["From Max"].default_value = 0.65
    pr.inputs["To Min"].default_value = 0.9
    pr.inputs["To Max"].default_value = 1.0
    nt.links.new(pores.outputs["Fac"], pr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mul.inputs["A"])
    nt.links.new(pr.outputs["Result"], mul.inputs["B"])
    return mul.outputs["Result"]


def roughness_map(grain: np.ndarray) -> np.ndarray:
    """glTF metallic-roughness image: G = roughness by height along the bat, B = 0 metal."""
    z0, z1 = PROFILE[0][1], PROFILE[-1][1]
    # v runs by arc length, close enough to height away from the end caps for a smooth map.
    z = z0 + (z1 - z0) * (np.arange(TEX_H) + 0.5) / TEX_H
    tar = np.array([_smooth(0.95, 0.15, zz) * _smooth(-0.16, -0.08, zz) for zz in z])
    knob = (z < -0.15).astype(float)
    rough = 0.3 + 0.32 * tar + 0.12 * knob
    rough = rough[:, None] + 0.08 * (1 - grain[..., 0])
    orm = np.ones((TEX_H, TEX_W, 4))
    orm[..., 1] = rough
    orm[..., 2] = 0.0
    return orm


def build():
    lods = []
    for i, (segments, steps) in enumerate([(24, 2), (12, 1)]):
        prof = smoothed(PROFILE, steps) if steps > 1 else PROFILE
        verts, faces, uvs, cols = scene.lathe(prof, segments, shade=finish)
        lods.append(scene.mesh_object(f"bat_LOD{i}", verts, faces, uvs=uvs, colors=cols))

    grain = bake.bake_emission(lods[0], grain_nodes, TEX_W, TEX_H)
    base = np.ones_like(grain)
    base[..., :3] = materials.linear_to_srgb(grain[..., :3])
    base_img = materials.image_from_array("bat_grain", base)
    orm_img = materials.image_from_array("bat_orm", roughness_map(grain), non_color=True)
    mat = materials.pbr("bat_wood", roughness=1.0, base_image=base_img, orm_image=orm_img)
    for ob in lods:
        materials.assign(ob, mat)
    return lods
