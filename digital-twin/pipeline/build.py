"""PL-01, PL-03, PL-04: USD 사이트 → 배경 GLB + site-config + 로봇 URDF 복사.

    uv run --project digital-twin/pipeline python digital-twin/pipeline/build.py [site ...]          만들기
    uv run --project digital-twin/pipeline python digital-twin/pipeline/build.py --check [site ...]  결과물이 최신인지(L1)

출력
- frontend/public/sites/{site}.glb      배경(정적 층)
- digital-twin/site-config/{site}.json  cells, background, name은 USD에서 생성. environment, presets는 기존 파일 값을 유지.
                                        프리셋이 없는 셀에는 셀 자세에서 계산한 클로즈업을 더한다(id = 셀 id)
- frontend/public/robots/{이름}/         digital-twin/assets/robot/{이름}/ 복사
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import glb
import twin_usd as tu
import validate

ROOT = tu.ROOT
PUBLIC = ROOT / "frontend" / "public"
CONFIG_DIR = ROOT / "digital-twin" / "site-config"
ROBOT_SRC = ROOT / "digital-twin" / "assets" / "robot"


# 셀 클로즈업 프리셋(셀 좌표계, m): 작업자 쪽(-X, -Y) 위에서 테이블을 본다
CLOSEUP_EYE = (-2.4, -3.2, 2.8)
CLOSEUP_TARGET = (0.8, 0.3, 1.1)
OVERVIEW_EYE_OFFSET = (-6.5, -7.0, 5.5)


def _cell_to_site(cell: dict, p) -> list:
    yaw = math.radians(cell["pose"]["yaw_deg"])
    c, s = math.cos(yaw), math.sin(yaw)
    x, y, z = cell["pose"]["position_m"]
    return [tu._num(round(v, 3) + 0.0) for v in (x + c * p[0] - s * p[1], y + s * p[0] + c * p[1], z + p[2])]


def presets(cells: list[dict], previous: list[dict] | None) -> list[dict]:
    """기존 프리셋은 그대로 두고, 클로즈업이 없는 셀에만 하나 더한다. 아무것도 없으면 전경도 만든다."""
    out = list(previous or [])
    if not out:
        cx = sum(c["pose"]["position_m"][0] for c in cells) / len(cells)
        cy = sum(c["pose"]["position_m"][1] for c in cells) / len(cells)
        target = [tu._num(round(cx, 3)), tu._num(round(cy, 3)), 0.5]
        eye = [tu._num(round(t + d, 3)) for t, d in zip(target, OVERVIEW_EYE_OFFSET)]
        out.append({"id": "overview", "name": "전경", "eye_m": eye, "target_m": target})
    have = {p["id"] for p in out}
    for c in cells:
        if c["id"] not in have:
            out.append({"id": c["id"], "name": f"{c['name']} 클로즈업", "eye_m": _cell_to_site(c, CLOSEUP_EYE), "target_m": _cell_to_site(c, CLOSEUP_TARGET)})
    return out


def site_config(site: str, stage, previous: dict | None) -> dict:
    root = stage.GetDefaultPrim()
    cells = []
    for cell in tu.cells(stage):
        cid = tu.pascal_to_kebab(cell.GetName())
        pose, _ = tu.local_pose(cell)
        robot, plate = cell.GetChild("Robot"), cell.GetChild("Plate")
        rpose, _ = tu.local_pose(robot)
        ppose, _ = tu.local_pose(plate)
        size = plate.GetAttribute("innoworks:sizeMm").Get()
        cells.append(
            {
                "id": cid,
                "name": cell.GetAttribute("innoworks:name").Get(),
                "pose": pose.to_json(),
                "plate": {"size_mm": [tu._num(size[0]), tu._num(size[1])], "pose": ppose.to_json()},
                "robot": {"urdf": robot.GetAttribute("innoworks:urdf").Get(), "pose": rpose.to_json()},
                "camera": {"stream": f"/stream/{cid}"},
            }
        )
    prev = previous or {}
    return {
        "v": 1,
        "site": site,
        "name": root.GetAttribute("innoworks:name").Get() or prev.get("name", site),
        "background": {"glb": f"/sites/{site}.glb"},
        "environment": prev.get("environment", {"hdri": None, "exposure": 1}),
        "cells": cells,
        "presets": presets(cells, prev.get("presets")),
    }


def dump_json(obj: dict) -> str:
    text = json.dumps(obj, ensure_ascii=False, indent=2)
    # 숫자만 든 배열은 한 줄로
    text = re.sub(
        r"\[\s*(-?[\d.eE+-]+(?:\s*,\s*-?[\d.eE+-]+)*)\s*\]",
        lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]",
        text,
    )
    return text + "\n"


def robot_files(urdfs: set[str]) -> dict[Path, bytes]:
    out: dict[Path, bytes] = {}
    for urdf in sorted(urdfs):
        name = urdf.removeprefix("/robots/").split("/")[0]
        src = ROBOT_SRC / name
        for f in sorted(p for p in src.rglob("*") if p.is_file()):
            out[PUBLIC / "robots" / name / f.relative_to(src)] = f.read_bytes()
    return out


def build(site: str) -> tuple[dict[Path, bytes], dict]:
    stage = tu.open_site(site)
    data, stats = glb.to_glb(glb.collect(stage), site, tu.load_materials())
    cfg_path = CONFIG_DIR / f"{site}.json"
    previous = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else None
    cfg = site_config(site, stage, previous)
    files = {PUBLIC / "sites" / f"{site}.glb": data, cfg_path: dump_json(cfg).encode("utf-8")}
    files.update(robot_files({c["robot"]["urdf"] for c in cfg["cells"]}))
    return files, stats


def main(argv: list[str]) -> int:
    check = "--check" in argv
    sites = [a for a in argv if not a.startswith("--")] or tu.list_sites()
    errs = [e for s in sites for e in validate.validate_site(s)]
    if errs:
        print("\n".join(errs), file=sys.stderr)
        print("USD 규칙 위반. validate.py 결과를 먼저 고친다.", file=sys.stderr)
        return 1
    stale = []
    for site in sites:
        files, stats = build(site)
        for path, data in files.items():
            rel = path.relative_to(ROOT)
            if check:
                if not path.exists() or path.read_bytes() != data:
                    stale.append(str(rel))
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        if not check:
            print(f"{site}: primitive {stats['primitives']}, 삼각형 {stats['triangles']}, 파일 {len(files)}개")
    if check:
        if stale:
            print("USD와 다른 결과물: " + ", ".join(stale), file=sys.stderr)
            print("build.py를 실행한다.", file=sys.stderr)
            return 1
        print(f"사이트 {len(sites)}개 결과물 최신")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
