"""로봇 생성기: 링크별 STL 메시 + URDF. 손으로 고치지 말고 이 파일을 고친다.

    uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_robot.py [--check]

로봇
- standin-6axis: 고정형 대역 6축 용접 로봇(AS-02, M1~M4). 관절 이름·원점·축은 바꾸지 않는다(픽스처, 테스트가 의존한다).
- spider-welder: 4족 자석발 이동 용접 로봇 대역(ADR 0003). spider.py.
메시는 각 링크 좌표계로 만든다. 실제 기종이 정해지면 제조사 메시로 바꾸되 관절 이름을 맞춘다.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np

import meshkit as mk
from meshkit import Model, cylinder, lathe, move, rot, rounded_box, tube

ROBOT_DIR = Path(__file__).resolve().parent.parent / "robot"

COLORS = {
    "body": "0.95 0.48 0.08 1",
    "dark": "0.16 0.17 0.19 1",
    "steel": "0.62 0.64 0.66 1",
    "copper": "0.80 0.48 0.28 1",
}


def ycyl(r, length, bevel=0.0, seg=32):
    """Y축 방향 원기둥(가운데 원점)"""
    return rot(cylinder(r, length, bevel, seg, center=True), "x", 90)


def xcyl(r, length, bevel=0.0, seg=32, start=0.0):
    """X축 방향 원기둥(x = start ~ start+length)"""
    return move(rot(cylinder(r, length, bevel, seg), "y", 90), (start, 0, 0))


def links() -> dict[str, Model]:
    L: dict[str, Model] = {}
    m = L["base_link"] = Model()
    m.add("dark", lathe([(0, 0), (0.2, 0), (0.2, 0.02), (0.175, 0.035), (0.16, 0.19), (0.15, 0.2), (0, 0.2)], 40))
    m = L["link_1"] = Model()
    m.add("body", lathe([(0, 0), (0.15, 0), (0.15, 0.012), (0.135, 0.13), (0, 0.13)], 40))
    m.add("body", move(rounded_box((0.26, 0.3, 0.22), 0.06), (0, 0, 0.21)))
    m.add("dark", move(xcyl(0.06, 0.14, 0.01, 28), (-0.26, 0.09, 0.16)))
    m = L["link_2"] = Model()
    m.add("dark", ycyl(0.105, 0.24, 0.012))
    m.add("body", move(rounded_box((0.14, 0.16, 0.6), 0.055), (0, 0, 0.35)))
    m.add("dark", move(ycyl(0.07, 0.03, 0.006), (0, 0.135, 0)))
    m = L["link_3"] = Model()
    m.add("dark", ycyl(0.09, 0.21, 0.012))
    m.add("body", move(rounded_box((0.26, 0.17, 0.17), 0.06), (0.02, 0, 0)))
    m.add("body", xcyl(0.058, 0.46, 0.012, 32, start=0.12))
    m.add("dark", xcyl(0.05, 0.11, 0.01, 28, start=-0.22))
    m = L["link_4"] = Model()
    m.add("body", xcyl(0.052, 0.12, 0.01, 32))
    m = L["link_5"] = Model()
    m.add("dark", move(rounded_box((0.09, 0.1, 0.09), 0.03), (0, 0, 0)))
    m.add("dark", ycyl(0.046, 0.12, 0.008))
    m = L["link_6"] = Model()
    m.add("steel", xcyl(0.036, 0.02, 0.003, 28))
    m = L["torch"] = Model()
    neck = mk.catmull_rom([[0, 0, 0], [0.08, 0, 0], [0.16, 0, -0.03], [0.22, 0, -0.1]], 8)
    m.add("dark", tube(neck, 0.017, 16))
    m.add("copper", tube([[0.22, 0, -0.1], [0.236, 0, -0.122], [0.252, 0, -0.144]], 0.014, 16))
    return L


JOINTS = """
  <joint name="joint_1" type="revolute">
    <parent link="base_link"/><child link="link_1"/>
    <origin xyz="0 0 0.2"/><axis xyz="0 0 1"/>
    <limit lower="-2.967" upper="2.967" effort="100" velocity="2"/>
  </joint>
  <joint name="joint_2" type="revolute">
    <parent link="link_1"/><child link="link_2"/>
    <origin xyz="0 0 0.25"/><axis xyz="0 1 0"/>
    <limit lower="-1.571" upper="2.356" effort="100" velocity="2"/>
  </joint>
  <joint name="joint_3" type="revolute">
    <parent link="link_2"/><child link="link_3"/>
    <origin xyz="0 0 0.7"/><axis xyz="0 1 0"/>
    <limit lower="-2.356" upper="1.571" effort="100" velocity="2"/>
  </joint>
  <joint name="joint_4" type="revolute">
    <parent link="link_3"/><child link="link_4"/>
    <origin xyz="0.6 0 0"/><axis xyz="1 0 0"/>
    <limit lower="-3.316" upper="3.316" effort="50" velocity="3"/>
  </joint>
  <joint name="joint_5" type="revolute">
    <parent link="link_4"/><child link="link_5"/>
    <origin xyz="0.12 0 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.181" upper="2.181" effort="50" velocity="3"/>
  </joint>
  <joint name="joint_6" type="revolute">
    <parent link="link_5"/><child link="link_6"/>
    <origin xyz="0.07 0 0"/><axis xyz="1 0 0"/>
    <limit lower="-6.283" upper="6.283" effort="20" velocity="4"/>
  </joint>
  <joint name="tool_joint" type="fixed">
    <parent link="link_6"/><child link="torch"/>
    <origin xyz="0.02 0 0"/>
  </joint>
"""


def stl(V: np.ndarray, F: np.ndarray, name: str = "standin-6axis") -> bytes:
    tris = V[F].astype(np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(F), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = n, tris
    return f"{name} twin-pipeline".encode().ljust(80, b"\0") + struct.pack("<I", len(F)) + rec.tobytes()


def write_robot(name: str, links_: dict[str, Model], colors: dict[str, str], joints_xml: str, comment: str) -> dict[Path, bytes]:
    out_dir = ROBOT_DIR / name
    files: dict[Path, bytes] = {}
    link_xml = []
    for lname, model in links_.items():
        visuals = []
        for mat, (V, F) in model.merged().items():
            fname = f"meshes/{lname}_{mat}.stl"
            files[out_dir / fname] = stl(V, F, name)
            visuals.append(
                f'    <visual>\n      <geometry><mesh filename="{fname}"/></geometry>\n      <material name="{mat}"/>\n    </visual>'
            )
        link_xml.append(f'  <link name="{lname}">\n' + "\n".join(visuals) + "\n  </link>" if visuals else f'  <link name="{lname}"/>')
    mats = "\n".join(f'  <material name="{k}"><color rgba="{v}"/></material>' for k, v in colors.items())
    urdf = (
        '<?xml version="1.0"?>\n'
        "<!--\n  생성 파일(digital-twin/assets/gen/make_robot.py). 직접 고치지 않는다.\n"
        + comment
        + "\n-->\n"
        f'<robot name="{name}">\n' + mats + "\n\n" + "\n\n".join(link_xml) + "\n" + joints_xml + "</robot>\n"
    )
    files[out_dir / "robot.urdf"] = urdf.encode("utf-8")
    return files


def standin() -> dict[Path, bytes]:
    return write_robot(
        "standin-6axis",
        links(),
        COLORS,
        JOINTS,
        "  대역 6축 용접 로봇(spec 7절). 실제 기종이 정해지면 같은 관절 이름(joint_1~joint_6)으로 교체한다.\n"
        "  좌표: Z-up, m. 관절 0°: 상완 수직, 전완 +X 수평.",
    )


def build() -> dict[Path, bytes]:
    import spider

    files = standin()
    files.update(write_robot(spider.NAME, spider.links(), spider.COLORS, spider.joints_xml(), spider.COMMENT))
    return files


def main() -> int:
    files = build()
    dirs = sorted({p.parent.parent if p.parent.name == "meshes" else p.parent for p in files})
    existing = {p for d in dirs if (d / "meshes").exists() for p in (d / "meshes").glob("*.stl")}
    extra = sorted(existing - set(files))
    if "--check" in sys.argv:
        stale = [str(p.relative_to(ROBOT_DIR)) for p, b in files.items() if not p.exists() or p.read_bytes() != b]
        if stale or extra:
            print("생성기와 다른 로봇 파일: " + ", ".join(stale + [str(p.relative_to(ROBOT_DIR)) for p in extra]) + ". make_robot.py를 실행한다.", file=sys.stderr)
            return 1
        print(f"로봇 {len(dirs)}대, 파일 {len(files)}개 최신")
        return 0
    for old in extra:
        old.unlink()
    for p, b in files.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
    for d in dirs:
        tris = sum((len(b) - 84) // 50 for p, b in files.items() if p.suffix == ".stl" and d in p.parents)
        print(f"{d.name}: 파일 {sum(1 for p in files if d in p.parents)}개, 삼각형 {tris}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
