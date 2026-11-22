"""
Build one asset headlessly:

    blender -b --factory-startup --python-exit-code 1 -P build_asset.py -- \
        --asset bat --out /tmp/out/bat.glb --report /tmp/out/bat.json [--preview bat.png]

Each asset is a module in ``assets/`` exposing ``SPEC`` (name, description, triangle budget
per LOD, texture size cap) and ``build() -> list[Object]`` (LOD0 first). This script resets
the scene, builds, checks the budgets, exports the GLB and writes a JSON report that
``scripts/build-assets.mjs`` turns into the manifest. Any budget or convention violation
exits non-zero, so a bad asset never reaches ``public/``.
"""
import argparse
import importlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

from wtbb3d import export, preview, scene  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--preview")
    args = ap.parse_args(argv)

    mod = importlib.import_module(f"assets.{args.asset}")
    spec = mod.SPEC
    if spec["name"] != args.asset:
        raise SystemExit(f"SPEC name {spec['name']!r} does not match module {args.asset!r}")

    scene.reset()
    objs = mod.build()
    export.apply_transforms(objs)

    errors = []
    lods = []
    budgets = spec["lods"]
    if len(objs) != len(budgets):
        errors.append(f"built {len(objs)} LODs, SPEC lists {len(budgets)}")
    for i, ob in enumerate(objs):
        want = f"{spec['name']}_LOD{i}"
        if ob.name != want:
            errors.append(f"object {ob.name!r} should be named {want!r}")
        ob.data.name = want
        ob["wtbb_lod"] = i
        tris = export.triangles(ob)
        budget = budgets[i] if i < len(budgets) else 0
        if tris > budget:
            errors.append(f"{want}: {tris} triangles over the budget of {budget}")
        if i and tris >= lods[-1]["triangles"]:
            errors.append(f"{want}: not coarser than LOD{i - 1}")
        wind = export.winding(ob)
        if spec.get("closed", True) and (wind["flipped_edges"] or wind["volume"] <= 0):
            errors.append(f"{want}: inconsistent or inward winding {wind}")
        imgs = export.image_info(ob)
        for im in imgs:
            if max(im["size"]) > spec.get("max_texture", 1024):
                errors.append(f"{want}: image {im['name']} {im['size']} over max_texture")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", spec["name"]):
            errors.append("asset names are lower_snake_case")
        lods.append(
            {
                "name": want,
                "triangles": tris,
                "vertices": len(ob.data.vertices),
                "budget": budget,
                "bounds": export.bounds_yup(ob),
                "volume": wind["volume"],
                "materials": [m.name for m in ob.data.materials if m],
                "images": imgs,
            }
        )

    report = {
        "name": spec["name"],
        "description": spec["description"],
        "blender": bpy.app.version_string,
        "lods": lods,
        "errors": errors,
    }
    if not errors:
        export.export_glb(objs, args.out)
        if args.preview:
            report["previewEngine"] = preview.render_preview(objs, args.preview, tint=spec.get("preview_tint"))
    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)
    if errors:
        for e in errors:
            print(f"[asset {spec['name']}] {e}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
