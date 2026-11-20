# 경로 수렴

코드: `server/snap/livewire.py`, 기하 `server/snap/geometry.py`. 검사: `tests/server/test_snap.py`.

## 알고리즘(확률 맵 livewire)

1. 수정을 시작할 때 멈춘 프레임으로 비전을 한 번 더 불러 용접선 확률 맵(0~1)을 얻는다.
2. 사람이 그린 선(원본 프레임 픽셀)에서 `corridor_px` 안의 띠만 본다. 확률 맵은 `step_px` 간격 격자로 읽는다.
3. 그린 선의 두 끝에서 `end_radius_px` 안에 확률이 가장 높은 곳(능선)을 시작·끝 노드로 잡는다. 끝 근처 최대 확률이 `min_end_prob`보다 낮으면 실패.
4. 띠 안에서 Dijkstra(8방향, 비용 `1 - 확률 + eps`)로 두 노드를 잇는 가장 싼 길을 찾는다.
5. 길 위 평균 확률(수렴 점수)이 `min_mean_prob`보다 낮으면 실패. 성공이면 길을 같은 간격 `points`점으로 다시 고른다(그린 방향 유지).
6. 픽셀 경로를 캘리브레이션 호모그래피로 면 mm로 바꿔 `task/snap`·`task/proposal`에 함께 싣는다.

확률 맵을 내지 않는 비전 모델이면 제안 경로를 용접선으로 보고 그린 선을 그 위로 붙인다(`snap_to_polyline`, Mock 서버와 같은 방식).

## 파라미터(`SnapParams`)

| 이름 | 기본 | 뜻 |
| --- | --- | --- |
| `corridor_px` | 40 | 그린 선에서 찾는 거리 |
| `end_radius_px` | 40 | 끝점을 붙일 반경 |
| `min_end_prob` | 0.5 | 끝 근처에 이만한 확률이 없으면 실패 |
| `min_mean_prob` | 0.6 | 길 평균 확률 하한 |
| `step_px` | 2 | 격자 간격(속도와 정밀도) |
| `points` | 9 | 보낼 점 수 |

실제 모델이 오면 확률 맵의 날카로움에 맞춰 `min_*`를 조정한다. 1280×720, 띠 40px에서 수렴은 0.1초 안팎이다.
