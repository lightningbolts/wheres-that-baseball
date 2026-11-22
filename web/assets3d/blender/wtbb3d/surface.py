"""
Tileable PBR surface sets ("material assets"): model real detail geometry over one square
tile (wrapped at the edges so it tiles), then bake it down onto a flat plane with Cycles —
base colour, tangent-space normals and ambient occlusion. The plane, with a material
holding the maps, is exported like any other asset; the web scene samples the maps in
world space (see components/game/scene/parks/surfaces.ts).

Tile convention: the plane spans [0, T] × [0, T] in Blender X/Y, UV u = x / T, v = y / T.
In three.js that is u along +X and v along −Z.
"""
import bpy
import numpy as np

from wtbb3d import materials, scene


def periodic_noise(n: int, beta: float, seed: int) -> np.ndarray:
    """
    n×n noise that tiles exactly (built in the frequency domain), power spectrum ∝ 1/f^beta,
    normalised to zero mean and unit standard deviation.
    """
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n)[:, None]
    fy = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / f ** (beta / 2)
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    return (out - out.mean()) / out.std()


def sample_periodic(field: np.ndarray, x: np.ndarray, y: np.ndarray, tile: float) -> np.ndarray:
    """Bilinear lookup of a periodic field at tile coordinates (wraps)."""
    n = field.shape[0]
    u = (np.asarray(x) / tile * n) % n
    v = (np.asarray(y) / tile * n) % n
    i0 = np.floor(u).astype(int)
    j0 = np.floor(v).astype(int)
    fu = u - i0
    fv = v - j0
    i1 = (i0 + 1) % n
    j1 = (j0 + 1) % n
    return (
        field[i0, j0] * (1 - fu) * (1 - fv)
        + field[i1, j0] * fu * (1 - fv)
        + field[i0, j1] * (1 - fu) * fv
        + field[i1, j1] * fu * fv
    )


def heightfield(name: str, tile: float, h: np.ndarray, colors: np.ndarray | None = None, margin: float = 0.08) -> bpy.types.Object:
    """
    A displaced grid over the tile from an n×n periodic height map (feet), extended past
    the edges by ``margin`` (wrapping) so bake rays near the border still hit geometry.
    ``colors`` (n×n×3, linear) become a ``Color`` attribute.
    """
    n = h.shape[0]
    extra = int(np.ceil(margin / tile * n))
    idx = np.arange(-extra, n + extra + 1)
    xs = idx / n * tile
    gx, gy = np.meshgrid(xs, xs, indexing="ij")
    wi = idx % n
    hh = h[np.ix_(wi, wi)]
    verts = np.stack([gx.ravel(), gy.ravel(), hh.ravel()], axis=1)
    m = len(idx)
    faces = []
    for i in range(m - 1):
        base = i * m
        faces.extend((base + j, base + m + j, base + m + j + 1, base + j + 1) for j in range(m - 1))
    cols = None
    if colors is not None:
        cols = colors[np.ix_(wi, wi)].reshape(-1, 3)
    return scene.mesh_object(name, verts, faces, colors=cols)


def wrapped(points: np.ndarray, tile: float, reach: float) -> list[tuple[np.ndarray, int]]:
    """
    Copies of scattered points shifted by ±tile wherever they come within ``reach`` of an
    edge, so detail crossing a border shows up on the opposite side as well. Returns
    (offset point, index of the original) pairs.
    """
    out = []
    for k, p in enumerate(points):
        for dx in (-tile, 0.0, tile):
            for dy in (-tile, 0.0, tile):
                q = p + np.array([dx, dy, 0.0])
                if -reach <= q[0] <= tile + reach and -reach <= q[1] <= tile + reach:
                    out.append((q, k))
    return out


def vertex_color_material(name: str, roughness: float = 0.8) -> bpy.types.Material:
    """A material whose base colour is the mesh's ``Color`` attribute (for the bake source)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _bake(kind: str, target: bpy.types.Object, sources: list[bpy.types.Object], size: int, extrusion: float, ray: float, samples: int, pass_filter=None) -> np.ndarray:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    bk = scn.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = extrusion
    bk.max_ray_distance = ray
    bk.margin = 0
    bk.use_clear = True
    bk.normal_space = "TANGENT"

    img = bpy.data.images.new(f"_bake_{kind}", width=size, height=size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    mat = target.data.materials[0]
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node

    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for s in sources:
        s.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    kwargs = {"type": kind}
    if pass_filter:
        kwargs["pass_filter"] = pass_filter
    bpy.ops.object.bake(**kwargs)

    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    mat.node_tree.nodes.remove(node)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)


def bake_set(
    name: str,
    tile: float,
    sources: list[bpy.types.Object],
    size: int = 1024,
    extrusion: float = 0.3,
    ray: float = 0.6,
    ao_strength: float = 0.8,
    roughness=None,
    normalise_albedo: bool = False,
    hue_keep: float = 0.3,
    samples: int = 16,
) -> bpy.types.Object:
    """
    Bake ``sources`` onto a flat tile plane and return the plane (named ``<name>_LOD0``)
    carrying a material with base colour (AO multiplied in), normal map and
    metallic-roughness maps. ``roughness`` is a float, an H×W array, or a function of the
    baked H×W ambient occlusion returning one (roughness that follows the modelled relief:
    rougher down in the crevices, smoother on what stands proud). The roughness image's red
    channel is left at 1 — the AO is already in the base colour and nothing reads it, and a
    flat channel compresses to nothing. With
    ``normalise_albedo`` the base colour becomes brightness relative to the mean (averaging
    0.5, linear) with ``hue_keep`` of its hue deviation: the scene then uses it as a colour
    *variation* multiplied by 2 over its own tint.
    The detail objects are deleted afterwards.
    """
    verts = np.array([(0, 0, 0), (tile, 0, 0), (tile, tile, 0), (0, tile, 0)], dtype=np.float64)
    uvs = np.array([(0, 0), (1, 0), (1, 1), (0, 1)], dtype=np.float64)
    plane = scene.mesh_object(f"{name}_LOD0", verts, [(0, 1, 2, 3)], uvs=uvs, smooth=False)
    scratch = bpy.data.materials.new(f"_scratch_{name}")
    scratch.use_nodes = True
    plane.data.materials.append(scratch)

    color = _bake("DIFFUSE", plane, sources, size, extrusion, ray, samples, pass_filter={"COLOR"})[..., :3]
    normal = _bake("NORMAL", plane, sources, size, extrusion, ray, samples)[..., :3]
    ao = _bake("AO", plane, sources, size, extrusion, ray, samples * 2)[..., :1]

    albedo = color * (1 - ao_strength + ao_strength * ao)
    if normalise_albedo:
        # Brightness relative to the mean, plus a damped share of the hue deviation, so the
        # map is a neutral-ish variation the scene multiplies (×2) over its own colour.
        lum = albedo @ np.array([0.2126, 0.7152, 0.0722])
        mean = albedo.reshape(-1, 3).mean(axis=0)
        mean_lum = float(mean @ np.array([0.2126, 0.7152, 0.0722]))
        hue = (albedo / np.maximum(lum[..., None], 1e-5)) / (mean / max(mean_lum, 1e-5))
        hue = 1 + hue_keep * (np.clip(hue, 0.5, 1.6) - 1)
        albedo = 0.5 * (lum / max(mean_lum, 1e-5))[..., None] * hue
    base = np.ones((size, size, 4))
    base[..., :3] = materials.linear_to_srgb(albedo)
    nrm = np.ones((size, size, 4))
    nrm[..., :3] = normal
    orm = np.ones((size, size, 4))
    if callable(roughness):
        roughness = roughness(ao[..., 0])
    orm[..., 1] = roughness if roughness is not None else 0.9
    orm[..., 2] = 0.0

    mat = materials.pbr(
        f"{name}_surface",
        base_image=materials.image_from_array(f"{name}_albedo", base),
        orm_image=materials.image_from_array(f"{name}_orm", orm, non_color=True),
        normal_image=materials.image_from_array(f"{name}_normal", nrm, non_color=True),
    )
    plane.data.materials.clear()
    plane.data.materials.append(mat)
    bpy.data.materials.remove(scratch)
    for s in sources:
        me = s.data
        bpy.data.objects.remove(s)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.context.view_layer.update()
    plane["wtbb_tile_ft"] = tile
    return plane
