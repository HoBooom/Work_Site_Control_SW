"""USD 정적 형상 → GLB. Blender 없이 결정적으로 만든다(같은 입력이면 같은 바이트, PL-06).

- 지원 형상: Cube, Mesh(validate.py가 나머지를 막는다)
- 셀의 Robot, Plate 아래는 내보내지 않는다(형상이 없어야 하지만 한 번 더 막는다, PL-04)
- 같은 재질끼리 하나의 primitive로 합친다(드로우 콜 = 재질 수). 재질은 라이브러리(AS-04)에서 온다
- 좌표: USD Z-up → glTF Y-up. (x, y, z) → (x, z, -y)
- 법선: auto smooth. 같은 위치의 꼭짓점끼리 면 각도가 CREASE_DEG 아래면 법선을 평균한다(원기둥은 매끈, 상자 모서리는 날카롭게)
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np
from pxr import Usd, UsdGeom

import twin_usd as tu

CREASE_DEG = 35.0


def smooth_normals(tris: np.ndarray, crease_deg: float = CREASE_DEG) -> np.ndarray:
    """(n,3,3) 삼각형 → (3n,3) 꼭짓점 법선."""
    fn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    corners = tris.reshape(-1, 3)
    corner_face = np.repeat(np.arange(len(tris)), 3)
    out = fn[corner_face].copy()
    _, inv = np.unique(np.round(corners, 5), axis=0, return_inverse=True)
    inv = inv.ravel()
    order = np.argsort(inv, kind="stable")
    bounds = np.flatnonzero(np.diff(inv[order])) + 1
    cos_t = np.cos(np.radians(crease_deg))
    for group in np.split(order, bounds):
        if len(group) < 2:
            continue
        N = fn[corner_face[group]]
        mask = (N @ N.T) > cos_t
        sm = mask.astype(np.float64) @ N
        out[group] = sm / np.maximum(np.linalg.norm(sm, axis=1, keepdims=True), 1e-12)
    return out


# 단위 큐브(-0.5~0.5)의 바깥을 향하는 삼각형(반시계)
_CUBE_V = np.array(
    [[x, y, z] for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)], dtype=np.float64
)
_CUBE_T = np.array(
    [
        [0, 1, 3], [0, 3, 2],  # -X
        [4, 6, 7], [4, 7, 5],  # +X
        [0, 4, 5], [0, 5, 1],  # -Y
        [2, 3, 7], [2, 7, 6],  # +Y
        [0, 2, 6], [0, 6, 4],  # -Z
        [1, 5, 7], [1, 7, 3],  # +Z
    ],
    dtype=np.int64,
)


@dataclass
class Group:
    material: str
    tris: list[np.ndarray] = field(default_factory=list)  # 각 (n, 3, 3) 월드 좌표 Z-up


def _local_tris(prim: Usd.Prim) -> np.ndarray:
    if prim.IsA(UsdGeom.Cube):
        size = UsdGeom.Cube(prim).GetSizeAttr().Get() or 2.0
        return (_CUBE_V * size)[_CUBE_T]
    mesh = UsdGeom.Mesh(prim)
    pts = np.array(mesh.GetPointsAttr().Get(), dtype=np.float64)
    counts = mesh.GetFaceVertexCountsAttr().Get()
    idx = mesh.GetFaceVertexIndicesAttr().Get()
    left = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
    tris, k = [], 0
    for n in counts:
        face = idx[k : k + n]
        k += n
        for i in range(1, n - 1):
            t = [face[0], face[i + 1], face[i]] if left else [face[0], face[i], face[i + 1]]
            tris.append(t)
    return pts[np.array(tris, dtype=np.int64)] if tris else np.zeros((0, 3, 3))


def _excluded_roots(stage: Usd.Stage) -> list[str]:
    out = []
    for cell in tu.cells(stage):
        out += [f"{cell.GetPath()}/Robot", f"{cell.GetPath()}/Plate"]
    return out


def collect(stage: Usd.Stage) -> list[Group]:
    cache = UsdGeom.XformCache(Usd.TimeCode.Default())
    excluded = _excluded_roots(stage)
    groups: dict[str, Group] = {}
    for prim in stage.Traverse():
        path = str(prim.GetPath())
        if any(path == e or path.startswith(e + "/") for e in excluded):
            continue
        if not (prim.IsA(UsdGeom.Cube) or prim.IsA(UsdGeom.Mesh)):
            continue
        img = UsdGeom.Imageable(prim)
        if img.ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        if img.ComputePurpose() not in (UsdGeom.Tokens.default_, UsdGeom.Tokens.render):
            continue
        local = _local_tris(prim)
        if not len(local):
            continue
        m = np.array(cache.GetLocalToWorldTransform(prim), dtype=np.float64)  # 행벡터 규약: p' = p·M
        flat = local.reshape(-1, 3)
        world = (np.hstack([flat, np.ones((len(flat), 1))]) @ m)[:, :3].reshape(-1, 3, 3)
        mat = tu.material_of(prim)
        if not mat:
            raise ValueError(f"{path}: {tu.MATERIAL_ATTR}가 없다(validate.py를 먼저 통과시킨다)")
        groups.setdefault(mat, Group(mat)).tris.append(world)
    return [groups[k] for k in sorted(groups)]


def _pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def to_glb(groups: list[Group], name: str, materials_lib: dict[str, dict]) -> tuple[bytes, dict]:
    """GLB 바이트와 통계(primitive 수, 삼각형 수)."""
    bin_parts: list[bytes] = []
    offset = 0
    buffer_views, accessors, materials, primitives = [], [], [], []
    triangles = 0

    def add_view(data: bytes) -> int:
        nonlocal offset
        data = _pad(data, b"\0")
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": 34962})
        bin_parts.append(data)
        offset += len(data)
        return len(buffer_views) - 1

    for g in groups:
        tris = np.concatenate(g.tris)  # (n, 3, 3) Z-up
        triangles += len(tris)
        pos = tris.reshape(-1, 3)
        nrm = smooth_normals(tris)
        to_y_up = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1).astype("<f4")  # noqa: E731
        pos, nrm = to_y_up(pos), to_y_up(nrm)
        pv = add_view(pos.tobytes())
        accessors.append(
            {
                "bufferView": pv,
                "componentType": 5126,
                "count": len(pos),
                "type": "VEC3",
                "min": [float(v) for v in pos.min(axis=0)],
                "max": [float(v) for v in pos.max(axis=0)],
            }
        )
        nv = add_view(nrm.tobytes())
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(nrm), "type": "VEC3"})
        lib = materials_lib[g.material]
        materials.append(
            {
                "name": g.material,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [*lib["base_color"], 1.0],
                    "metallicFactor": lib["metallic"],
                    "roughnessFactor": lib["roughness"],
                },
            }
        )
        primitives.append(
            {"attributes": {"POSITION": len(accessors) - 2, "NORMAL": len(accessors) - 1}, "material": len(materials) - 1}
        )

    binary = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "twin-pipeline"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": f"background:{name}", "mesh": 0}],
        "meshes": [{"name": f"background:{name}", "primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(binary)}],
    }
    js = _pad(json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), b" ")
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary
    glb = struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
    return glb, {"primitives": len(primitives), "triangles": triangles}


def read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError("GLB 헤더가 잘못되었다")
    jlen, jtype = struct.unpack_from("<II", data, 12)
    if jtype != 0x4E4F534A:
        raise ValueError("첫 청크가 JSON이 아니다")
    gltf = json.loads(data[20 : 20 + jlen])
    rest = data[20 + jlen :]
    binary = b""
    if rest:
        blen, btype = struct.unpack_from("<II", rest, 0)
        if btype != 0x004E4942:
            raise ValueError("둘째 청크가 BIN이 아니다")
        binary = rest[8 : 8 + blen]
    return gltf, binary
