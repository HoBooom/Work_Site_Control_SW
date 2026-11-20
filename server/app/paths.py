"""저장소 경로. 서버는 저장소의 contracts·site-config·픽스처를 그대로 읽는다."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
SITE_CONFIG = ROOT / "digital-twin" / "site-config"
FIXTURES = ROOT / "digital-twin" / "fixtures"
MOCK_SITES = ROOT / "tools" / "mock" / "sites.json"
DATA = ROOT / "data"
WEB_DIST = ROOT / "frontend" / "dist"
