"""서버 검사 공통: 계약 검사기와 시험용 작업 단위."""
import pytest

from bus.contracts import Contracts
from snap.geometry import homography
from task import machine as m

C = Contracts()
H = homography([([0, 0], [1000, 2000]), ([1000, 0], [2000, 2000]), ([1000, 500], [2000, 1500]), ([0, 500], [1000, 1500])])
SEAM = [[100, 250], [500, 240], [900, 230]]
OP = {"cmd_id": "c0ffee00-0001", "operator": "op-test"}


def assert_contract(out):
    """머신이 낸 메시지가 계약을 통과한다(v·ts는 bus가 붙인다)"""
    for msg in out:
        spec = C.cell[msg["suffix"]]
        errs = C.errors(spec.schema, {"v": 1, "ts": 1, **msg["payload"]})
        assert not errs, f"{msg['suffix']}: {errs}"


def new_unit():
    return m.Unit(cell="spider-1", surface="bottom-shell", frame_size=[1000, 500], H=H)


@pytest.fixture
def proposed():
    u = new_unit()
    r = m.propose(u, SEAM, 0.88)
    assert_contract(r.out)
    return u
