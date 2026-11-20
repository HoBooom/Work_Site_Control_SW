"""경로 수렴(livewire)과 기하."""
import numpy as np
import pytest

from mock.frames import make_frame
from mock.vision import MockVision
from adapters.base import Frame
from snap.geometry import apply, length, remaining, snap_to_polyline
from snap.livewire import snap

from conftest import H, SEAM


def test_homography():
    assert [round(v) for v in apply(H, [1000, 500])] == [2000, 1500]
    assert [round(v) for v in apply(H, [500, 250])] == [1500, 1750]


def test_polyline_snap():
    ok, path, _ = snap_to_polyline(SEAM, [[150, 262], [480, 255], [850, 246]])
    assert ok
    for x, y in path:
        assert abs(y - (250 - (x - 100) * 0.025)) < 0.2
    assert not snap_to_polyline(SEAM, [[100, 450], [900, 450]])[0]


def test_remaining():
    line = [[0, 0], [100, 0], [200, 0]]
    rest = remaining(line, 0.25)
    assert rest[0] == [50, 0] and rest[-1] == [200, 0] and len(rest) == 3
    assert length(rest) == pytest.approx(150)


@pytest.fixture(scope="module")
def fillet():
    img, seam, Hm, png = make_frame("fillet", [[4420, 4012], [5180, 4012]], seed=1)
    f = Frame("spider-1", img, 0, png, meta={"seam_px": seam})
    return f, seam, MockVision().infer(f)


def dist_to(seam, p):
    from snap.geometry import nearest_on_polyline

    return nearest_on_polyline(seam, p)[1]


def test_livewire_follows_seam(fillet):
    f, seam, vr = fillet
    drawn = [[seam[2][0], seam[2][1] + 12], [seam[5][0], seam[5][1] - 10], [seam[8][0], seam[8][1] + 14]]
    r = snap(vr.prob, tuple(f.size), drawn)
    assert r.ok, r.reason
    assert len(r.path_px) == 9
    assert max(dist_to(seam, p) for p in r.path_px) < 2.5, "수렴 경로는 용접선 위"
    assert r.path_px[0][0] == pytest.approx(seam[2][0], abs=6) and r.path_px[-1][0] == pytest.approx(seam[8][0], abs=6), "그린 구간만"
    assert r.score > 0.9


def test_livewire_keeps_direction(fillet):
    f, seam, vr = fillet
    r = snap(vr.prob, tuple(f.size), [seam[9], seam[3]])
    assert r.ok and r.path_px[0][0] > r.path_px[-1][0], "그린 방향(오른쪽 → 왼쪽)을 지킨다"


def test_livewire_fails_far(fillet):
    f, _, vr = fillet
    r = snap(vr.prob, tuple(f.size), [[256, 662], [1024, 662]])
    assert not r.ok
    assert r.path_px == [[256, 662], [1024, 662]], "실패면 그린 선 그대로"


def test_livewire_fails_short(fillet):
    f, seam, vr = fillet
    assert not snap(vr.prob, tuple(f.size), [seam[3], [seam[3][0] + 1, seam[3][1]]]).ok


def test_prob_map_shape(fillet):
    f, _, vr = fillet
    assert vr.prob.shape == (360, 640) and 0 <= float(vr.prob.min()) and float(vr.prob.max()) <= 1
    assert isinstance(vr.prob, np.ndarray)
