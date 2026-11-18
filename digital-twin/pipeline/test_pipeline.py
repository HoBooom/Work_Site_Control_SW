"""L1: 파이프라인 단위 테스트.

    uv run --project digital-twin/pipeline python -m unittest discover -s digital-twin/pipeline -p "test_*.py"
"""
from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom

import build
import glb
import twin_usd as tu
import validate


class Naming(unittest.TestCase):
    def test_round_trip(self):
        for pascal, kebab in [("WeldCell1", "weld-cell-1"), ("Shipyard", "shipyard"), ("CellA", "cell-a"), ("Line12B", "line-12-b")]:
            self.assertEqual(tu.pascal_to_kebab(pascal), kebab)
            self.assertEqual(tu.kebab_to_pascal(kebab), pascal)

    def test_kebab(self):
        self.assertTrue(tu.is_kebab("weld-cell-1"))
        self.assertFalse(tu.is_kebab("Weld-cell"))
        self.assertFalse(tu.is_kebab("weld--cell"))


def _xform(stage, path, translate=(0, 0, 0), rot=None, scale=None):
    x = UsdGeom.Xform.Define(stage, path)
    x.AddTranslateOp().Set(Gf.Vec3d(*translate))
    if rot is not None:
        x.AddRotateXYZOp().Set(Gf.Vec3f(*rot))
    if scale is not None:
        x.AddScaleOp().Set(Gf.Vec3f(*scale))
    return x.GetPrim()


class Pose(unittest.TestCase):
    def setUp(self):
        self.stage = Usd.Stage.CreateInMemory()

    def test_translate_and_yaw(self):
        p = _xform(self.stage, "/A", (1, 2, 3), rot=(0, 0, 90))
        pose, why = tu.local_pose(p)
        self.assertIsNone(why)
        np.testing.assert_allclose(pose.position_m, (1, 2, 3))
        self.assertAlmostEqual(pose.yaw_deg, 90, places=5)

    def test_rejects_tilt_and_scale(self):
        self.assertIsNotNone(tu.local_pose(_xform(self.stage, "/B", rot=(10, 0, 0)))[1])
        self.assertIsNotNone(tu.local_pose(_xform(self.stage, "/C", scale=(2, 1, 1)))[1])


LIB = tu.load_materials()


def _mat(prim, name="bare_steel"):
    prim.CreateAttribute(tu.MATERIAL_ATTR, Sdf.ValueTypeNames.Token).Set(name)


class Glb(unittest.TestCase):
    def test_cube_to_y_up(self):
        stage = Usd.Stage.CreateInMemory()
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        cube = UsdGeom.Cube.Define(stage, "/Box")
        cube.GetSizeAttr().Set(1.0)
        _mat(cube.GetPrim())
        cube.AddTranslateOp().Set(Gf.Vec3d(0, 0, 0.5))  # 바닥에 놓인 1m 큐브, 윗면 z=1
        groups = glb.collect(stage)
        data, stats = glb.to_glb(groups, "t", LIB)
        self.assertEqual(stats, {"primitives": 1, "triangles": 12})
        gltf, binary = glb.read_glb(data)
        self.assertEqual(gltf["materials"][0]["name"], "bare_steel")
        self.assertEqual(gltf["materials"][0]["pbrMetallicRoughness"]["metallicFactor"], LIB["bare_steel"]["metallic"])
        acc = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
        # Z-up의 z(0~1)가 Y-up의 y가 된다
        self.assertAlmostEqual(acc["min"][1], 0, places=6)
        self.assertAlmostEqual(acc["max"][1], 1, places=6)
        pos = np.frombuffer(binary[: acc["count"] * 12], dtype="<f4").reshape(-1, 3, 3)
        nrm = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
        center = pos.mean(axis=1) - np.array([0, 0.5, 0])
        self.assertTrue(np.all(np.einsum("ij,ij->i", nrm, center) > 0), "모든 면이 바깥을 향해야 한다")

    def test_smooth_normals(self):
        import sys
        sys.path.insert(0, str(tu.ROOT / "digital-twin" / "assets" / "gen"))
        import meshkit as mk

        # 원기둥 옆면은 매끈(이웃 꼭짓점 법선이 같다), 윗면 모서리는 날카롭다(윗면 법선은 +Z 그대로)
        V, F = mk.cylinder(0.5, 1.0, seg=32)
        tris = V[F]
        n = glb.smooth_normals(tris)
        top = np.isclose(tris.reshape(-1, 3)[:, 2], 1.0) & np.isclose(np.repeat(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])[:, 2] > 0, 3), True)
        np.testing.assert_allclose(n[top], np.tile([0, 0, 1], (top.sum(), 1)), atol=1e-6)
        side = ~np.isclose(np.abs(n[:, 2]), 1.0)
        self.assertTrue(np.allclose(np.abs(n[side][:, 2]), 0, atol=1e-6), "옆면 법선은 수평")
        # 상자는 모든 면이 90°라 평평한 법선 그대로
        V, F = mk.rounded_box((1, 1, 1))
        n = glb.smooth_normals(V[F])
        self.assertTrue(np.allclose(np.abs(n).max(axis=1), 1.0))

    def test_deterministic(self):
        stage = Usd.Stage.CreateInMemory()
        _mat(UsdGeom.Cube.Define(stage, "/A").GetPrim())
        b_cube = UsdGeom.Cube.Define(stage, "/B")
        b_cube.AddTranslateOp().Set(Gf.Vec3d(3, 0, 0))
        _mat(b_cube.GetPrim(), "safety_yellow")
        a, _ = glb.to_glb(glb.collect(stage), "x", LIB)
        b, _ = glb.to_glb(glb.collect(stage), "x", LIB)
        self.assertEqual(a, b)


SITE_OK = """#usda 1.0
(
    defaultPrim = "Testsite"
    metersPerUnit = 1
    upAxis = "Z"
)
def Xform "Testsite" (customData = {string "innoworks:role" = "site"})
{
    def Xform "CellA" (customData = {string "innoworks:role" = "cell"})
    {
        string innoworks:name = "셀 A"
        def Xform "Robot" (customData = {string "innoworks:role" = "robot"})
        {
            string innoworks:urdf = "/robots/standin-6axis/robot.urdf"
            %ROBOT_CHILD%
        }
        def Xform "Plate" (customData = {string "innoworks:role" = "plate"})
        {
            float2 innoworks:sizeMm = (1000, 500)
        }
    }
}
"""


class Validate(unittest.TestCase):
    def run_site(self, text: str) -> list[str]:
        with tempfile.TemporaryDirectory() as d:
            Path(d, "testsite.usda").write_text(text, encoding="utf-8")
            old = tu.SITES_DIR
            tu.SITES_DIR = Path(d)
            try:
                return validate.validate_site("testsite")
            finally:
                tu.SITES_DIR = old

    def test_ok(self):
        self.assertEqual(self.run_site(SITE_OK.replace("%ROBOT_CHILD%", "")), [])

    def test_robot_with_geometry(self):
        errs = self.run_site(SITE_OK.replace("%ROBOT_CHILD%", 'def Cube "Body" {}'))
        self.assertTrue(any("/Testsite/CellA/Robot" in e and "PL-04" in e for e in errs), errs)

    def test_material_library(self):
        robotless = SITE_OK.replace("%ROBOT_CHILD%", "")
        no_mat = robotless.replace('def Xform "CellA"', 'def Cube "Box" {}\n    def Xform "CellA"')
        errs = self.run_site(no_mat)
        self.assertTrue(any("/Testsite/Box" in e and "innoworks:material" in e for e in errs), errs)
        unknown = robotless.replace('def Xform "CellA"', 'def Cube "Box"\n    {\n        token innoworks:material = "gold"\n    }\n    def Xform "CellA"')
        self.assertTrue(any("gold" in e for e in self.run_site(unknown)))
        own = robotless.replace(
            'def Xform "CellA"',
            'def Cube "Box"\n    {\n        token innoworks:material = "bare_steel"\n        color3f[] primvars:displayColor = [(1, 0, 0)]\n    }\n    def Xform "CellA"',
        )
        self.assertTrue(any("displayColor" in e for e in self.run_site(own)))

    def test_unsupported_geometry_and_y_up(self):
        text = SITE_OK.replace("%ROBOT_CHILD%", "").replace('upAxis = "Z"', 'upAxis = "Y"')
        text = text.replace('def Xform "CellA"', 'def Sphere "Ball" {}\n    def Xform "CellA"')
        errs = self.run_site(text)
        self.assertTrue(any("upAxis" in e for e in errs), errs)
        self.assertTrue(any("/Testsite/Ball" in e and "Sphere" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()


class Presets(unittest.TestCase):
    CELL = {"id": "weld-booth-1", "name": "부스", "pose": {"position_m": [1, 2, 0], "yaw_deg": 90}}

    def test_closeup_follows_cell_pose(self):
        out = build.presets([self.CELL], None)
        self.assertEqual([p["id"] for p in out], ["overview", "weld-booth-1"])
        close = out[1]
        # 셀 좌표 (x, y) → 90° 회전 → (-y, x) + 셀 위치
        ex, ey, ez = build.CLOSEUP_EYE
        np.testing.assert_allclose(close["eye_m"], [1 - ey, 2 + ex, ez], atol=1e-9)
        tx, ty, tz = build.CLOSEUP_TARGET
        np.testing.assert_allclose(close["target_m"], [1 - ty, 2 + tx, tz], atol=1e-9)

    def test_keeps_existing_and_adds_missing(self):
        prev = [{"id": "overview", "name": "손으로", "eye_m": [9, 9, 9], "target_m": [0, 0, 0]}]
        out = build.presets([self.CELL], prev)
        self.assertEqual(out[0], prev[0])
        self.assertEqual([p["id"] for p in out], ["overview", "weld-booth-1"])
        self.assertEqual(build.presets([self.CELL], out), out, "두 번 돌려도 같다")
