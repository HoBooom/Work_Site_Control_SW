# 0005 서버 전에 프론트를 만들고, 서버 자리에 MQTT Mock 서버를 둔다

날짜: 2026-11-18
상태: 채택

## 결정

- 관제 웹앱(사이드 패널, 수정 모드, 알람, 긴급정지)을 FastAPI 서버보다 먼저 만든다(사용자 결정). 기능명세는 `frontend/docs/spec.md`.
- 서버 자리에는 `tools/mock-server.mjs`(Node)를 둔다. MQTT로 명령(`cmd/*`)을 받아 상태 머신(`tools/mock/machine.mjs`)대로 답하고, 상태·제안·수렴·진행률·알람·메트릭을 보낸다. 웹은 명령만 보내고 받은 상태로 화면을 바꾸는 규칙을 그대로 지킨다. 브라우저 안 가짜 서버는 쓰지 않는다.
- 상태 전이 표(spec 3절)는 서버 명세 초안이다. Mock과 서버가 같은 표를 따르고, 표는 L2(`node --test tools/`)로 모든 전이와 거부를 검사한다.
- 카메라 영상은 임의의 그림(사용자 결정). `tools/mock/frames.mjs`가 강판·용접선을 그리고, 그림 위 용접선 픽셀과 면 mm 대응점 4쌍(호모그래피)을 함께 만든다. 실제 카메라·로봇 연결은 맨 뒤(F5)다.
- 긴급정지·재개는 셀 토픽(그 로봇)과 사이트 토픽 `innoworks/{site}/cmd/…`(모든 로봇) 둘 다(사용자 결정). 운영자 로그인은 아직 없다(브라우저마다 만든 id).

## 계약 변경

명령 스키마 6개(`cmd-*`), `vision/metrics`, `heartbeat`, `task/proposal`·`task/snap`의 `frame_id`·`frame_size`·`path_px`, `alarm.cmd_id`. topics.json에 `command_topics`(scopes: cell, site), `operator_topics`.

## 다음

- F1~F4는 spec 8절. 서버 단계에서 Mock 서버를 FastAPI 서버로 바꾸고 같은 L3를 통과시킨다.
