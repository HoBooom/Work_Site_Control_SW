# 정지 조건

코드: `server/safety/`. 상태 전이는 `task/machine.py`가 한다(여기는 감지만).

| 조건 | 감지 | 결과 |
| --- | --- | --- |
| 긴급정지(웹) | `cmd/estop`(셀·사이트 토픽) | 모든 상태 → estopped, 로봇 `stop()`. 명령 줄을 건너뛴다 |
| 운영자 화면 끊김 | `innoworks/operator/+/heartbeat`가 `--heartbeat-timeout-ms`(기본 3초) 넘게 없음. 가장 최근 화면 기준, 한 번도 없었으면 판정 안 함 | running → paused |
| 장면 변화 | 이웃 프레임 밝기 차이(64×64 축소)의 평균. 60 차이를 1로 본 외란 강도가 0.35를 3장 연달아 넘음 | running → paused. 외란 강도는 `vision/metrics.disturbance`로도 나간다 |
| 서버 비정상 종료 | 브로커가 셀마다 유언 `status=offline` | 웹이 버튼을 막는다. 로봇 쪽 정지는 로봇 제어기의 통신 감시가 맡는다(팀원 확인 필요) |

- 소프트웨어 정지는 하드웨어 E-stop을 대신하지 않는다.
- 재개는 사람이 `cmd/resume`으로만 한다. 자동 재개는 없다.
