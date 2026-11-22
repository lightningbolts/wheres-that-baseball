"""
Images and glTF-friendly materials.

Node layouts here are the ones the glTF exporter recognises: an image straight into Base
Color, an image through Separate Color (G = roughness, B = metallic) into Roughness /
Metallic, an image through a Normal Map node into Normal. Anything fancier (mix nodes,
procedural textures) is not exported, so procedural looks are baked to images first
(see bake.py).
"""
import bpy
import numpy as np


def image_from_array(name: str, rgba: np.ndarray, non_color: bool = False) -> bpy.types.Image:
    """
    An image from an H×W×4 float array in [0, 1], row 0 at the bottom (Blender's order).
    Colour images hold display (sRGB-encoded) values; data images (roughness, normals) hold
    raw values and are tagged Non-Color.
    """
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    img.pack()
    return img


def pbr(
    name: str,
    base_color=(1.0, 1.0, 1.0, 1.0),
    roughness: float = 0.5,
    metallic: float = 0.0,
    base_image: bpy.types.Image | None = None,
    orm_image: bpy.types.Image | None = None,
    normal_image: bpy.types.Image | None = None,
) -> bpy.types.Material:
    """A Principled BSDF material laid out for clean glTF export."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if base_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = base_image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if orm_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = orm_image
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if normal_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def assign(ob: bpy.types.Object, mat: bpy.types.Material) -> None:
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    """Encode linear values for a colour (sRGB) image."""
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
