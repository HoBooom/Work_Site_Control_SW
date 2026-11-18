"""L1: 배경 GLB 검사. 형식, 예산(budget.json per_site), site-config와의 연결.

    uv run --project digital-twin/pipeline python digital-twin/pipeline/check_glb.py [site ...]

드로우 콜·삼각형은 배경 GLB만 센다. 로봇·작업판·용접선을 더한 씬 전체는 L5가 잰다.
"""
from __future__ import annotations

import json
import sys

import glb
import twin_usd as tu

ROOT = tu.ROOT


def check_site(site: str, budget: dict) -> tuple[list[str], dict]:
    errs: list[str] = []
    cfg = json.loads((ROOT / "digital-twin" / "site-config" / f"{site}.json").read_text(encoding="utf-8"))
    url = cfg["background"]["glb"]
    if url != f"/sites/{site}.glb":
        errs.append(f"site-config/{site}.json: background.glb가 /sites/{site}.glb가 아니다: {url}")
    path = ROOT / "frontend" / "public" / "sites" / f"{site}.glb"
    if not path.exists():
        return errs + [f"{path.relative_to(ROOT)} 없음. build.py를 실행한다"], {}
    data = path.read_bytes()
    try:
        gltf, binary = glb.read_glb(data)
    except ValueError as e:
        return errs + [f"{path.relative_to(ROOT)}: {e}"], {}
    prims = [p for m in gltf.get("meshes", []) for p in m["primitives"]]
    tris = sum(gltf["accessors"][p["attributes"]["POSITION"]]["count"] // 3 for p in prims)
    stats = {"site": site, "bytes": len(data), "primitives": len(prims), "triangles": tris}
    per = budget["per_site"]
    if len(data) > per["glb_mb_max"] * 1024 * 1024:
        errs.append(f"{site}.glb 크기 {len(data) / 1048576:.1f}MB > {per['glb_mb_max']}MB")
    if len(prims) > per["draw_calls_max"]:
        errs.append(f"{site}.glb primitive {len(prims)} > 드로우 콜 예산 {per['draw_calls_max']}")
    if tris > per["triangles_max"]:
        errs.append(f"{site}.glb 삼각형 {tris} > {per['triangles_max']}")
    names = [n.get("name", "") for n in gltf.get("nodes", [])] + [m.get("name", "") for m in gltf.get("meshes", [])]
    if any("robot" in n.lower() for n in names):
        errs.append(f"{site}.glb에 로봇 이름이 든 노드가 있다(PL-04)")
    if len(binary) != gltf["buffers"][0]["byteLength"]:
        errs.append(f"{site}.glb BIN 길이가 buffers[0]과 다르다")
    return errs, stats


def main(argv: list[str]) -> int:
    budget = json.loads((ROOT / "digital-twin" / "harness" / "budget.json").read_text(encoding="utf-8"))
    sites = argv or tu.list_sites()
    errs: list[str] = []
    for site in sites:
        e, stats = check_site(site, budget)
        errs += e
        if stats:
            print(f"{site}.glb: {stats['bytes'] / 1024:.0f}KB, primitive {stats['primitives']}, 삼각형 {stats['triangles']}")
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
