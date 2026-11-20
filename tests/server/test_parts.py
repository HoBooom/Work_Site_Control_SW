"""계약 토픽 해석, 안전(heartbeat·장면 변화), 저장, Mock 어댑터."""
import json

import numpy as np

from bus.contracts import Contracts
from mock.camera import MockCamera
from mock.robot import MockRobot
from safety.heartbeat import HeartbeatWatch
from safety.scene import SceneWatch
from storage.db import Storage
from task import machine as m

from conftest import SEAM, new_unit

C = Contracts()


def test_topic_parse():
    assert C.parse("ship-block", "innoworks/ship-block/spider-1/cmd/approve")["name"] == "approve"
    site = C.parse("ship-block", "innoworks/ship-block/cmd/estop")
    assert site["cell"] is None and site["name"] == "estop"
    assert C.parse("ship-block", "innoworks/ship-block/cmd/approve") is None, "승인은 사이트 범위가 없다"
    assert C.parse("ship-block", "innoworks/factory/weld-booth-1/cmd/approve") is None, "다른 사이트"
    assert C.parse("ship-block", "innoworks/operator/web-1/heartbeat")["kind"] == "heartbeat"
    assert C.parse("ship-block", "innoworks/ship-block/spider-1/cmd/fly") is None


def test_heartbeat_watch():
    w = HeartbeatWatch(3000)
    assert not w.lost(10_000), "한 번도 받지 못했으면 판정하지 않는다"
    w.beat("a", 10_000)
    assert not w.lost(12_000)
    w.beat("b", 11_500)
    assert not w.lost(14_000), "가장 최근 화면 기준"
    assert w.lost(14_600)


def test_scene_watch():
    s = SceneWatch(threshold=0.35, frames=2)
    a = np.full((72, 128, 3), 100, np.uint8)
    b = np.full((72, 128, 3), 200, np.uint8)
    assert s.update("c", a) == 0
    assert s.update("c", a) == 0 and not s.changed("c")
    s.update("c", b)
    assert s.level["c"] == 1.0 and not s.changed("c")
    s.update("c", a)
    assert s.changed("c"), "크게 바뀐 프레임이 연달아 오면 변화"


def test_storage(tmp_path):
    st = Storage(tmp_path)
    u = new_unit()
    m.propose(u, SEAM, 0.9)
    st.upsert_task(1, "ship-block", u.cell, u.task_id, u.state, u.surface, u.proposal)
    st.event(2, "ship-block", u.cell, u.task_id, "approved", {"edited": False})
    st.upsert_task(3, "ship-block", u.cell, u.task_id, "idle", result="ok")
    st.save_frame("f-1", b"\x89PNG", "image/png")
    rows = st.tasks()
    assert rows[0]["task_id"] == u.task_id and rows[0]["result"] == "ok" and rows[0]["path_px"] == u.proposal.path_px
    assert st.events(u.task_id)[0]["kind"] == "approved"
    assert st.load_frame("f-1") == (b"\x89PNG", "image/png")
    assert np.load(tmp_path / "tasks" / u.task_id / "path_mm.npy").shape == (3, 2)
    st.close()


def test_mock_camera_matches_node_frames():
    cam = MockCamera("ship-block", ["spider-1", "spider-2"])
    f = cam.latest("spider-1")
    assert f.size == [1280, 720] and f.encoded[:4] == b"\x89PNG"
    cal = cam.calibration("spider-1")
    assert cal["surface"] == "bottom-shell"
    # 용접선 끝점이 면 mm 용접선 끝점으로 간다(tools/mock/sites.json)
    from snap.geometry import to_mm

    seam = f.meta["seam_px"]
    assert to_mm(cal["H"], [seam[0], seam[-1]]) == [[4420.0, 4012.0], [5180.0, 4012.0]]


def test_mock_robot_motion():
    r = MockRobot("ship-block", ["spider-1"], run_ms=1000)
    idle = json.dumps(r.get_state("spider-1"))
    r.execute("spider-1", [[0, 0], [1, 1]], "bottom-shell")
    r.units["spider-1"]["start"] -= 500
    p, done = r.progress("spider-1")
    assert 0.45 < p < 0.6 and not done
    assert json.dumps(r.get_state("spider-1")) != idle, "용접 중에는 다른 자세"
    r.stop("spider-1")
    assert 0.45 < r.units["spider-1"]["offset"] < 0.6
    r.execute("spider-1", [[0, 0]], None)
    r.units["spider-1"]["start"] -= 600
    assert r.progress("spider-1") == (1.0, True), "남은 몫만 실행한다"
