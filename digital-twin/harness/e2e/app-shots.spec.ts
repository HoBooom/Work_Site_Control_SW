// L4 관제 화면 패널(frontend/docs/spec.md 7절): 영상 + 경로 + 버튼 영역의 상태별 기준 화면.
// 사이드 패널 전체를 찍고, 시시각각 바뀌는 메트릭(추론 지연·외란)은 가린다. 진행 중(실행)은 시각에 따라 달라 뺀다.
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
  mock = await startMockServer({ site: 'ship-block', url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 200, runMs: 1000 });
});
test.afterEach(async () => {
  await mock.close();
});

async function open(page: Page, cell: string) {
  await page.setViewportSize({ width: 1280, height: 1000 }); // 패널이 스크롤 없이 다 보이는 높이
  await page.goto(`/?site=ship-block&broker=ws://localhost:${broker.wsPort}&media=http://localhost:${mock.httpPort}`);
  await expect(page.getByTestId(`robot-row-${cell}`)).toHaveAttribute('data-state', 'proposed');
  await page.getByTestId(`robot-row-${cell}`).click();
  const img = page.getByTestId('camera').locator('img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1280);
}

const work = (page: Page) => page.getByTestId('app-panel');
const shot = (page: Page) => ({ mask: [page.getByTestId('unit-live')] });

async function draw(page: Page, pts: [number, number][]) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 4 });
  await page.mouse.up();
}

test.describe('관제 패널 기준 화면 @L4', () => {
  test('app-panel-proposed', async ({ page }) => {
    await open(page, 'spider-1');
    await expect(work(page)).toHaveScreenshot('app-panel-proposed.png', shot(page));
  });

  test('app-panel-editing', async ({ page }) => {
    await open(page, 'spider-1');
    await page.getByTestId('btn-edit').click();
    await expect(page.getByTestId('camera')).toHaveAttribute('data-mode', 'edit');
    const img = page.getByTestId('camera').locator('img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1280);
    await expect(work(page)).toHaveScreenshot('app-panel-editing.png', shot(page));
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
    await expect(work(page)).toHaveScreenshot('app-panel-snap-failed.png', shot(page));
  });

  test('app-panel-completed', async ({ page }) => {
    await open(page, 'spider-1');
    await page.getByTestId('btn-approve').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'completed');
    await expect(page.getByTestId('btn-confirm-ok')).toBeEnabled();
    await expect(work(page)).toHaveScreenshot('app-panel-completed.png', shot(page));
  });
});
