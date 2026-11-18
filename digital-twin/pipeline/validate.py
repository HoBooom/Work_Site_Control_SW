"""L1: USD 사이트 규칙 검사(PL-02). 어긴 곳을 prim 경로와 함께 모두 출력한다.

    uv run --project digital-twin/pipeline python digital-twin/pipeline/validate.py [site ...]
"""
from __future__ import annotations

import sys

from pxr import Usd, UsdGeom

import twin_usd as tu


def validate_site(site: str) -> list[str]:
    errs: list[str] = []
    where = f"digital-twin/sites/{site}.usda"

    def err(path: str, msg: str) -> None:
        errs.append(f"{where}:{path}: {msg}")

    if not tu.is_kebab(site):
        err("/", f"파일 이름이 kebab-case가 아니다: {site}")
    stage = tu.open_site(site)
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.z:
        err("/", f"upAxis는 Z여야 한다: {UsdGeom.GetStageUpAxis(stage)}")
    if UsdGeom.GetStageMetersPerUnit(stage) != 1.0:
        err("/", f"metersPerUnit은 1이어야 한다: {UsdGeom.GetStageMetersPerUnit(stage)}")

    root = stage.GetDefaultPrim()
    expected_root = tu.kebab_to_pascal(site)
    if not root:
        err("/", "defaultPrim이 없다")
        return errs
    if root.GetName() != expected_root:
        err(str(root.GetPath()), f"defaultPrim 이름은 {expected_root}여야 한다")
    if tu.role(root) != "site":
        err(str(root.GetPath()), 'customData "innoworks:role" = "site"가 없다')
    if not tu.is_identity(root):
        err(str(root.GetPath()), "사이트 루트에 변환이 있다")

    materials = tu.load_materials()
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Gprim) and prim.GetTypeName() not in tu.SUPPORTED_GEOMETRY:
            err(str(prim.GetPath()), f"지원하지 않는 형상 {prim.GetTypeName()}. Mesh 또는 Cube로 바꾼다")
        if prim.IsA(UsdGeom.Gprim):
            # AS-04: 형상은 재질 라이브러리를 이름으로 참조하고 자체 색을 갖지 않는다
            mat = tu.material_of(prim)
            if not mat:
                err(str(prim.GetPath()), f"{tu.MATERIAL_ATTR}가 없다. assets/materials/library.json의 이름을 쓴다")
            elif mat not in materials:
                err(str(prim.GetPath()), f"재질 라이브러리에 없는 재질: {mat}")
            pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar("displayColor")
            if pv and pv.HasAuthoredValue():
                err(str(prim.GetPath()), "자체 색(displayColor)을 갖지 않는다. 재질 라이브러리를 쓴다")
        if prim.IsA(UsdGeom.Xformable):
            m = UsdGeom.Xformable(prim).GetLocalTransformation()
            if m.GetDeterminant3() <= 0:
                err(str(prim.GetPath()), "음수 스케일(뒤집힌 변환)이 있다")

    cells = tu.cells(stage)
    if not cells:
        err(str(root.GetPath()), 'role이 "cell"인 자식이 없다')
    ids: set[str] = set()
    for cell in cells:
        path = str(cell.GetPath())
        cid = tu.pascal_to_kebab(cell.GetName())
        if tu.kebab_to_pascal(cid) != cell.GetName() or not tu.is_kebab(cid):
            err(path, f"셀 이름이 PascalCase ↔ kebab-case로 왕복되지 않는다({cid})")
        if cid in ids:
            err(path, f"셀 id 중복: {cid}")
        ids.add(cid)
        if not cell.GetAttribute("innoworks:name").Get():
            err(path, "innoworks:name이 없다")
        _, why = tu.local_pose(cell)
        if why:
            err(path, f"셀 자세: {why}")

        # Plate는 고정 로봇 셀만 갖는다. 이동 로봇 셀은 Plate 없이 surfaces 위에서 일한다(ADR 0003)
        for child, child_role in (("Robot", "robot"), ("Plate", "plate")):
            p = cell.GetChild(child)
            cpath = f"{path}/{child}"
            if not p:
                if child == "Robot":
                    err(cpath, "없다")
                continue
            if tu.role(p) != child_role:
                err(cpath, f'customData "innoworks:role" = "{child_role}"가 없다')
            if tu.has_geometry(p):
                err(cpath, "형상을 가지면 안 된다. 기준점만 두고 웹이 그린다(PL-04)")
            _, why = tu.local_pose(p)
            if why:
                err(cpath, f"자세: {why}")

        robot = cell.GetChild("Robot")
        if robot:
            urdf = robot.GetAttribute("innoworks:urdf").Get()
            if not urdf:
                err(f"{path}/Robot", "innoworks:urdf가 없다")
            elif not urdf.startswith("/robots/") or not urdf.endswith(".urdf"):
                err(f"{path}/Robot", f"innoworks:urdf는 /robots/<이름>/<파일>.urdf 형식이다: {urdf}")
            elif not (tu.ROOT / "digital-twin" / "assets" / "robot" / urdf.removeprefix("/robots/")).exists():
                err(f"{path}/Robot", f"URDF 원본이 digital-twin/assets/robot/에 없다: {urdf}")
        plate = cell.GetChild("Plate")
        if plate:
            size = plate.GetAttribute("innoworks:sizeMm").Get()
            if size is None or len(size) != 2 or min(size) <= 0:
                err(f"{path}/Plate", "innoworks:sizeMm(float2, 양수)가 없다")

    # 강판 면(surfaces): 용접선이 놓이는 면. 기준점만 두고 형상은 갖지 않는다
    sids: set[str] = set()
    for s in tu.surfaces(stage):
        spath = str(s.GetPath())
        sid = tu.pascal_to_kebab(s.GetName())
        if tu.kebab_to_pascal(sid) != s.GetName() or not tu.is_kebab(sid):
            err(spath, f"면 이름이 PascalCase ↔ kebab-case로 왕복되지 않는다({sid})")
        if sid in sids:
            err(spath, f"면 id 중복: {sid}")
        sids.add(sid)
        if any(spath.startswith(str(c.GetPath()) + "/") for c in cells):
            err(spath, "면은 셀 밖(사이트에 고정된 구조물)에 둔다")
        if tu.has_geometry(s):
            err(spath, "형상을 가지면 안 된다. 기준점만 둔다")
        if not s.GetAttribute("innoworks:name").Get():
            err(spath, "innoworks:name이 없다")
        size = s.GetAttribute("innoworks:sizeMm").Get()
        if size is None or len(size) != 2 or min(size) <= 0:
            err(spath, "innoworks:sizeMm(float2, 양수)가 없다")
        _, why = tu.site_pose(s)
        if why:
            err(spath, f"자세: {why}")
    return errs


def main(argv: list[str]) -> int:
    sites = argv or tu.list_sites()
    if not sites:
        print("digital-twin/sites/에 USD가 없다", file=sys.stderr)
        return 1
    errs = [e for s in sites for e in validate_site(s)]
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    print(f"사이트 {len(sites)}개 통과: {', '.join(sites)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
