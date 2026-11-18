import { defineConfig } from '@playwright/test';

const PORT = 5180;

// 검사 환경 고정: 1280×720, 픽셀 비율 1(harness.md 결정성 규칙).
export default defineConfig({
  testDir: './e2e',
  // check.sh가 단계마다 따로 준다. Playwright는 실행마다 outputDir를 비우므로 L4 결과를 L5가 지우지 않게 한다.
  outputDir: process.env.PW_OUTPUT_DIR ?? './out/test-results/adhoc',
  // GOLDEN_DIR: check.sh --candidates가 out/review/로 바꿔 후보만 찍는다(기준 이미지는 건드리지 않는다)
  snapshotPathTemplate: process.env.GOLDEN_DIR ? `${process.env.GOLDEN_DIR}/{arg}{ext}` : '{testDir}/../golden/{arg}{ext}',
  // 기준 이미지가 없으면 실패한다. 기본값('missing')은 찍은 화면을 승인 없이 기준으로 저장한다.
  // 갱신은 check.sh --update-golden(사람 승인 뒤)으로만 한다.
  updateSnapshots: 'none',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    // threshold: 픽셀별 색 차이 허용치. 기본값 0.2는 회색 바닥끼리 같은 것으로 칠 만큼 느슨해서
    // 조명·톤매핑 변화를 놓친다. 같은 맥에서는 화면이 바이트 단위로 같으므로 0.02로 조인다.
    toHaveScreenshot: { maxDiffPixelRatio: 0.005, threshold: 0.02, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    browserName: 'chromium',
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npm run dev -w frontend -- --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
