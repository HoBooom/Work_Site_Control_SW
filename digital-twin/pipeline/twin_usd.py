"""USD 사이트 읽기 공용 코드. 규칙은 digital-twin/docs/README.md "이름 규칙", "에셋 구조".

사이트 파일: digital-twin/sites/{site}.usda, defaultPrim = PascalCase(site).
셀: 사이트 루트의 자식 중 customData "innoworks:role" = "cell". prim 이름 PascalCase ↔ 셀 id kebab-case.
셀 안: Robot(role robot, innoworks:urdf), Plate(role plate, innoworks:sizeMm). 둘 다 기준점만 두고 형상을 갖지 않는다.
자세: 셀·Robot·Plate는 이동과 Z축 회전만 쓴다.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from pxr import Gf, Usd, UsdGeom

ROOT = Path(__file__).resolve().parents[2]
SITES_DIR = ROOT / "digital-twin" / "sites"
ROLE_KEY = "innoworks:role"
MATERIAL_ATTR = "innoworks:material"
MATERIAL_LIBRARY = ROOT / "digital-twin" / "assets" / "materials" / "library.json"
SUPPORTED_GEOMETRY = ("Cube", "Mesh")
EPS = 1e-6

_KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def pascal_to_kebab(name: str) -> str:
    """WeldCell1 → weld-cell-1, Shipyard → shipyard"""
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", name)
    s = re.sub(r"(?<=[A-Za-z])(?=[0-9])", "-", s)
    s = re.sub(r"(?<=[0-9])(?=[A-Za-z])", "-", s)
    return s.lower()


def kebab_to_pascal(name: str) -> str:
    """weld-cell-1 → WeldCell1"""
    return "".join(part[:1].upper() + part[1:] for part in name.split("-"))


def is_kebab(name: str) -> bool:
    return bool(_KEBAB.match(name))


def role(prim: Usd.Prim) -> str | None:
    # GetCustomDataByKey는 ':'를 중첩 경로로 읽으므로 딕셔너리로 꺼낸다
    return prim.GetCustomData().get(ROLE_KEY)


@dataclass
class Pose:
    position_m: tuple[float, float, float]
    yaw_deg: float

    def to_json(self) -> dict:
        return {"position_m": [_num(v) for v in self.position_m], "yaw_deg": _num(self.yaw_deg)}


def _num(v: float) -> float | int:
    r = round(float(v), 6)
    if r == 0:
        return 0
    return int(r) if r.is_integer() else r


def local_pose(prim: Usd.Prim) -> tuple[Pose | None, str | None]:
    """부모 기준 자세. 이동 + Z축 회전이 아니면 (None, 이유)."""
    m: Gf.Matrix4d = UsdGeom.Xformable(prim).GetLocalTransformation()
    r0, r1, r2 = m.GetRow3(0), m.GetRow3(1), m.GetRow3(2)
    if abs(r2[2] - 1) > EPS or abs(r2[0]) > EPS or abs(r2[1]) > EPS or abs(r0[2]) > EPS or abs(r1[2]) > EPS:
        return None, "Z축 이외의 회전이 있다"
    if abs(r0.GetLength() - 1) > EPS or abs(r1.GetLength() - 1) > EPS:
        return None, "스케일이 있다"
    t = m.ExtractTranslation()
    yaw = math.degrees(math.atan2(r0[1], r0[0]))
    return Pose((t[0], t[1], t[2]), yaw), None


@dataclass
class SurfacePose:
    position_m: tuple[float, float, float]
    orientation_xyzw: tuple[float, float, float, float]

    def to_json(self) -> dict:
        return {"position_m": [_num(v) for v in self.position_m], "orientation_xyzw": [_num(v) for v in self.orientation_xyzw]}


def site_pose(prim: Usd.Prim) -> tuple[SurfacePose | None, str | None]:
    """사이트 루트(변환 없음) 기준 자세: 위치 + 쿼터니언(xyzw, w ≥ 0). 스케일이 있으면 (None, 이유)."""
    m: Gf.Matrix4d = UsdGeom.XformCache(Usd.TimeCode.Default()).GetLocalToWorldTransform(prim)
    rows = [m.GetRow3(i) for i in range(3)]
    if any(abs(r.GetLength() - 1) > EPS for r in rows):
        return None, "스케일이 있다"
    q = m.ExtractRotationQuat()
    x, y, z = q.GetImaginary()
    w = q.GetReal()
    if w < 0 or (abs(w) < EPS and (x, y, z) < (0, 0, 0)):
        x, y, z, w = -x, -y, -z, -w
    t = m.ExtractTranslation()
    return SurfacePose((t[0], t[1], t[2]), (x, y, z, w)), None


def surfaces(stage: Usd.Stage) -> list[Usd.Prim]:
    """role이 "surface"인 prim 전부(에셋 안에 있어도 된다). 경로 순서."""
    root = stage.GetDefaultPrim()
    return [p for p in Usd.PrimRange(root) if role(p) == "surface"] if root else []


def is_identity(prim: Usd.Prim) -> bool:
    m = UsdGeom.Xformable(prim).GetLocalTransformation()
    return all(abs(m[i][j] - (1 if i == j else 0)) < EPS for i in range(4) for j in range(4))


def open_site(site: str) -> Usd.Stage:
    path = SITES_DIR / f"{site}.usda"
    if not path.exists():
        raise FileNotFoundError(path)
    return Usd.Stage.Open(str(path))


def list_sites() -> list[str]:
    return sorted(p.stem for p in SITES_DIR.glob("*.usda"))


def cells(stage: Usd.Stage) -> list[Usd.Prim]:
    root = stage.GetDefaultPrim()
    return [p for p in root.GetChildren() if role(p) == "cell"] if root else []


def has_geometry(prim: Usd.Prim) -> bool:
    return any(p.IsA(UsdGeom.Gprim) for p in Usd.PrimRange(prim))


def load_materials(path: Path = MATERIAL_LIBRARY) -> dict[str, dict]:
    """재질 라이브러리(AS-04). 이름 → {base_color, metallic, roughness}"""
    return json.loads(path.read_text(encoding="utf-8"))["materials"]


def material_of(prim: Usd.Prim) -> str | None:
    a = prim.GetAttribute(MATERIAL_ATTR)
    return a.Get() if a and a.HasAuthoredValue() else None
