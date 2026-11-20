# welding-hitl

조선소·제조공장 용접 현장용 관제 소프트웨어. **AI가 제안한 용접 경로를 사람이 3D 디지털 트윈 웹앱에서 확인·수정·승인하고, 로봇이 실행한 뒤 사람이 결과를 확인한다.**

React + three.js(R3F) 웹 · MQTT · Python FastAPI 서버 · USD 3D 원본. 실제 장비 없이 맥에서 Mock으로 처음부터 끝까지 돈다.

## 빠른 시작

```bash
./init.sh
```

필요한 것(Node 20+, uv)을 점검하고 의존성을 설치한 뒤, 브로커 + 관제 서버 + 프론트를 띄운다. 브라우저로 **http://localhost:5173/** 를 연다. 끝낼 때는 Ctrl+C.

`./init.sh --check`(점검만), `./init.sh mock`(파이썬 없이), `LAN=1 ./init.sh`(태블릿) 등은 [사용법](docs/usage.md#1-실행)에 있다.

## 문서

| 문서 | 누구에게 | 내용 |
| --- | --- | --- |
| [개요](docs/overview.md) | 처음 보는 사람, 검수자 | 무엇을 왜 만드나, 작업 흐름, 지금 상태, 진짜와 Mock, 용어, 검수 포인트 |
| [사용법](docs/usage.md) | 운영자, 개발자 | 설치·실행, 화면 조작 따라 하기, 태블릿, 개발용 화면, 서버 API, 검사, 문제 해결 |
| [아키텍처 위키](docs/architecture.md) | 개발자, 검수자 | 구성도, 원칙, 계약, 상태 머신, 메시지 흐름, 구획별 구조, 하네스, 확장, ADR 요약 |

구획별 상세: [contracts](contracts/docs/README.md) · [digital-twin](digital-twin/docs/README.md) · [server](server/docs/README.md) · [frontend](frontend/docs/README.md) · 설계 결정 [docs/adr](docs/adr/)

## 상태 (2026-11-20)

디지털 트윈 M0~M5, 관제 웹앱 F0~F4, 관제 서버(Mock 장비)까지 완료. 남은 것은 실제 비전·로봇·카메라 연결, Jetson(MIC-711D) 실행 확인, 태블릿 사람 확인이다. 자세히는 [개요](docs/overview.md#지금-어디까지-됐나-2026-11-20).
