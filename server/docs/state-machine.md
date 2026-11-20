# 작업 상태 머신

코드: `server/task/machine.py`(순수 모듈), 조율: `server/task/service.py`. 검사: `tests/server/test_machine.py`(L2).
Mock 서버(`tools/mock/machine.mjs`)와 같은 표를 따르고, 같은 관제 화면 검사(L3 `app.spec.ts`)를 두 서버가 통과한다.

## 상태

`idle` → `proposed` → (`editing` ↔ `proposed`) → `running` → `completed` → `idle`. 어디서나 `estopped`, 실행 중에는 `paused`.

| 명령·사건 | 받는 상태 | 결과 |
| --- | --- | --- |
| 비전 제안 | idle(대기 `--propose-ms` 뒤) | 새 `task_id`, proposed. 제안 프레임을 저장한다 |
| `edit_start` | proposed | editing. 지금 프레임을 멈춰 새 `frame_id`로 알리고, 그 프레임의 확률 맵을 구한다 |
| `drag` | editing(같은 `frame_id`) | 수렴(`snap.md`). 성공: `task/snap` ok + 그 경로로 proposed(신뢰도 = 수렴 점수, 상한 0.97). 실패: editing 그대로 + `SNAP_FAILED`(id `{cell}-snap`) |
| `edit_cancel` | editing | 수정 전 제안으로 proposed. 수렴 실패 알람 해제 |
| `approve` | proposed | running. 로봇 어댑터 `execute(경로 mm)` |
| 로봇 진행률 | running | `task/progress`(0.5초마다). 끝나면 completed |
| `confirm` | completed | 기록하고 idle. `rework`면 비전을 다시 불러 같은 자리를 새 작업으로 제안 |
| `estop` | 아무 상태 | estopped + `ESTOP`(critical, id `{cell}-estop`). 로봇 `stop`. 사이트 토픽이면 모든 로봇. 줄을 서지 않고 바로 처리 |
| heartbeat 끊김 | running | paused + `HEARTBEAT_LOST`(id `{cell}-heartbeat`). 한 번도 받지 못했으면 판정하지 않는다 |
| 장면 변화 | running | paused + `SCENE_CHANGED`(id `{cell}-scene`). 영상이 바뀌는 실제 카메라에서만 |
| `resume` | estopped, paused | 하던 작업이 있으면 proposed, 없으면 idle. 그 알람 해제 |

- `task_id`·`frame_id`가 지금 것이 아닌 명령, 허용되지 않은 상태의 명령은 거부: `CMD_REJECTED`(warning, `cmd_id`), 상태는 그대로.
- 계약(스키마)에 맞지 않는 명령도 같은 알람으로 거부한다.
- 명령은 받은 순서대로 하나씩 처리한다(수정 시작 → 드래그처럼 앞 결과가 필요하다). 긴급정지만 줄을 서지 않는다.
- 수렴하는 사이에 상태가 바뀌면(정지 등) 수렴 결과를 버린다.

## 멈춘 뒤 다시 시작(남은 경로)

용접하던 중에 긴급정지·일시정지되면, 재개 뒤의 제안은 남은 경로다(멈춘 곳 ~ 끝, 점 수는 그대로).
다시 승인하면 로봇은 남은 경로만 용접하고, `task/progress`는 처음 경로 기준으로 이어진다(예: 50%에서 멈춤 → 50% → 100%).
멈춘 뒤 경로를 새로 그리면(수렴 성공) 처음부터다.

Node Mock 서버는 남은 경로를 자르지 않는다(처음 경로를 다시 제안). 화면 검사는 두 경우를 구분하지 않는다.
