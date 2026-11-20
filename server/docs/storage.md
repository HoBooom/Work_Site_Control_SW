# 저장 구조

코드: `server/storage/db.py`. 위치: `--data`(기본 저장소 `data/`, git 제외). `--data none`이면 메모리만(검사).

```
data/
├─ server.sqlite        tasks, events
├─ frames/{frame_id}.png|jpg   제안·수정에 쓴 프레임(/frames/{frame_id}가 메모리에 없으면 여기서 낸다)
└─ tasks/{task_id}/path_mm.npy, path_px.npy   마지막 경로
```

| 표 | 열 |
| --- | --- |
| `tasks` | task_id, site, cell, surface, created_ts, updated_ts, state, confidence, edited(사람이 고쳤나), result(ok·rework), path_mm, path_px(JSON) |
| `events` | ts, site, cell, task_id, kind(proposed, approved, snapped, snap_failed, rejected, estop, paused, resume, completed, confirmed), detail(JSON) |

조회: `GET /api/tasks?limit=50`, `GET /api/tasks/{task_id}/events`. 저장이 실패해도 작업은 멈추지 않는다(로그만).
