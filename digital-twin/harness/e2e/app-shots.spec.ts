// L4 관제 화면 패널(frontend/docs/spec.md 7절): 영상 + 경로 + 버튼 영역의 상태별 기준 화면.
// 사이드 패널 전체를 찍는다. Mock은 메트릭을 고정값으로 보내고(fixedMetrics), 실행 중은 진행률이 0%에 머물게 아주 길게 돌린다.
import { expect, test, type Page } from '@playwright/test';
import { startBroker, type Broker } from '../../../infra/broker.mjs';
import { startMockServer, type MockServer } from '../../../tools/mock-server.mjs';

let broker: Broker;
let mock: MockServer;
test.beforeAll(async () => {
  broker = await startBroker({ tcpPort: 0, wsPort: 0 });
});
test.afterAll(async () => {
  await broker.close();
});
test.beforeEach(async () => {
  mock = await startMockServer({ site: 'ship-block', url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 200, runMs: 1000, fixedMetrics: true });
});
test.afterEach(async () => {
  await mock.close();
});

/** size: 기본은 패널이 스크롤 없이 다 보이는 높이. 태블릿 크기는 실제 화면 그대로 찍는다 */
async function open(page: Page, cell: string, size = { width: 1280, height: 1000 }) {
  await page.setViewportSize(size);
  await page.goto(`/?site=ship-block&broker=ws://localhost:${broker.wsPort}&media=http://localhost:${mock.httpPort}`);
  await expect(page.getByTestId(`robot-row-${cell}`)).toHaveAttribute('data-state', 'proposed');
  await page.getByTestId(`robot-row-${cell}`).click();
  const img = page.getByTestId('camera').locator('img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1280);
  await expect(page.getByTestId('unit-latency')).toHaveText('70ms');
  await expect(page.getByTestId('unit-disturbance')).toHaveText('12%');
}

const work = (page: Page) => page.getByTestId('app-panel');

async function draw(page: Page, pts: [number, number][]) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 4 });
  await page.mouse.up();
}

test.describe('관제 패널 기준 화면 @L4', () => {
  test('app-panel-proposed', async ({ page }) => {
    await open(page, 'spider-1');
    await expect(work(page)).toHaveScreenshot('app-panel-proposed.png');
  });

  test('app-panel-editing', async ({ page }) => {
    await open(page, 'spider-1');
    await page.getByTestId('btn-edit').click();
    await expect(page.getByTestId('camera')).toHaveAttribute('data-mode', 'edit');
    const img = page.getByTestId('camera').locator('img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1280);
    await expect(work(page)).toHaveScreenshot('app-panel-editing.png');
  });

  test('app-panel-snap-failed', async ({ page }) => {
    await open(page, 'spider-2');
    await page.getByTestId('btn-edit').click();
    await expect(page.getByTestId('camera')).toHaveAttribute('data-mode', 'edit');
    const cam = (await page.getByTestId('camera').boundingBox())!;
    await draw(page, [
      [cam.x + cam.width * 0.15, cam.y + cam.height * 0.2],
      [cam.x + cam.width * 0.2, cam.y + cam.height * 0.8],
    ]);
    await expect.poll(async () => (await page.evaluate(() => window.__app!.overlay('spider-2')?.failed))).toBe(true);
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-pending', '0');
    await expect(work(page)).toHaveScreenshot('app-panel-snap-failed.png');
  });

  test('app-panel-completed', async ({ page }) => {
    await open(page, 'spider-1');
    await page.getByTestId('btn-approve').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'completed');
    await expect(page.getByTestId('btn-confirm-ok')).toBeEnabled();
    await expect(work(page)).toHaveScreenshot('app-panel-completed.png');
  });

  test('app-panel-running', async ({ page }) => {
    await mock.close();
    mock = await startMockServer({ site: 'ship-block', url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 200, runMs: 1e9, fixedMetrics: true });
    await open(page, 'spider-1');
    await page.getByTestId('btn-approve').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'running');
    await expect(page.getByTestId('unit-progress')).toHaveText('0%');
    await expect(work(page)).toHaveScreenshot('app-panel-running.png');
  });

  test('app-panel-estopped', async ({ page }) => {
    await open(page, 'spider-1');
    await page.getByTestId('btn-estop').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'estopped');
    await expect(page.getByTestId('btn-resume')).toBeEnabled();
    await expect(work(page)).toHaveScreenshot('app-panel-estopped.png');
  });

  for (const [name, size] of [
    ['tablet', { width: 1180, height: 820 }],
    ['portrait', { width: 820, height: 1180 }],
  ] as const) {
    test(`app-panel-${name}`, async ({ page }) => {
      await open(page, 'spider-1', size);
      await expect(page.getByTestId('btn-approve')).toBeEnabled();
      await expect(work(page)).toHaveScreenshot(`app-panel-${name}.png`);
    });
  }
});
