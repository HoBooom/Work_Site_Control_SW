// L3 관제 화면(F0, frontend/docs/spec.md): 배치, 로봇 목록·선택, 패널 영상, 긴급정지(전체·로봇별)·재개.
// 브로커(aedes)와 Mock 서버(tools/mock-server.mjs)를 이 검사가 빈 포트에 띄운다.
import { expect, test, type Page } from '@playwright/test';
import mqtt from 'mqtt';
import { startBroker, type Broker } from '../../../infra/broker.mjs';
import { startMockServer, type MockServer } from '../../../tools/mock-server.mjs';

const SITE = 'ship-block';
const CELLS = ['spider-1', 'spider-2'];
let broker: Broker;
let mock: MockServer;

test.beforeAll(async () => {
  broker = await startBroker({ tcpPort: 0, wsPort: 0 });
});
test.afterAll(async () => {
  await broker.close();
});
test.beforeEach(async () => {
  mock = await startMockServer({ site: SITE, url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 300, runMs: 2000 });
});
test.afterEach(async () => {
  await mock.close();
});

async function openApp(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/React DevTools|THREE\.Clock/.test(m.text()) && problems.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`/?site=${SITE}&broker=ws://localhost:${broker.wsPort}&media=http://localhost:${mock.httpPort}`);
  await expect(page.getByTestId('bus-state')).toHaveAttribute('data-state', 'connected');
  return { expectClean: () => expect(problems, '콘솔 오류·경고가 없어야 한다').toEqual([]) };
}

const rowState = (page: Page, cell: string) => page.getByTestId(`robot-row-${cell}`);

test.describe('관제 화면 @L3', () => {
  for (const [label, size] of [
    ['노트북', { width: 1280, height: 720 }],
    ['태블릿 가로', { width: 1180, height: 820 }],
    ['태블릿 세로', { width: 820, height: 1180 }],
  ] as const) {
    test(`UI-01 ${label}: 상태 줄·패널·트윈·하단 독이 화면 안에 겹치지 않고, 알람은 트윈 위, 전체 긴급정지가 보인다`, async ({ page }) => {
      await page.setViewportSize(size);
      const app = await openApp(page);
      const boxes = await Promise.all(
        ['app-panel', 'app-scene', 'app-dock'].map(async (id) => [id, (await page.getByTestId(id).boundingBox())!] as const),
      );
      const header = (await page.locator('.app-header').boundingBox())!;
      const all = [['header', header] as const, ...boxes];
      for (const [id, b] of all) {
        expect(b.width, `${id} 폭`).toBeGreaterThan(100);
        expect(b.height, `${id} 높이`).toBeGreaterThan(36);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${id} 오른쪽`).toBeLessThanOrEqual(size.width + 0.5);
        expect(b.y + b.height, `${id} 아래`).toBeLessThanOrEqual(size.height + 0.5);
      }
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const [a, A] = all[i];
          const [b, B] = all[j];
          const overlap = Math.max(0, Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x)) * Math.max(0, Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y));
          expect(overlap, `${a}와 ${b}가 겹친다`).toBeLessThan(1);
        }
      // 알람 카드는 트윈 안에 뜬다
      const scene = boxes[1][1];
      const alarms = (await page.getByTestId('app-alarms').boundingBox())!;
      expect(alarms.x).toBeGreaterThanOrEqual(scene.x);
      expect(alarms.y).toBeGreaterThanOrEqual(scene.y);
      expect(alarms.x + alarms.width).toBeLessThanOrEqual(scene.x + scene.width + 0.5);
      expect(alarms.y + alarms.height).toBeLessThanOrEqual(scene.y + scene.height + 0.5);
      const estop = (await page.getByTestId('btn-estop-all').boundingBox())!;
      expect(estop.x + estop.width, '전체 긴급정지가 화면 안').toBeLessThanOrEqual(size.width);
      expect(estop.height, '손가락으로 누를 크기').toBeGreaterThanOrEqual(44);
      app.expectClean();
    });
  }

  test('UI-02: 로봇 목록이 서버 상태를 따르고, 고르면 그 로봇의 패널·영상이 뜬다', async ({ page }) => {
    const app = await openApp(page);
    for (const cell of CELLS) await expect(rowState(page, cell), `${cell} 제안`).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-1').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-cell', 'spider-1');
    expect(await page.evaluate(() => window.__app!.selection())).toEqual({ site: SITE, cell: 'spider-1', kind: 'robot', id: 'spider-1' });
    await expect(page.getByTestId('unit-task')).toHaveText(/^t-spider-1-/);
    await expect(page.getByTestId('unit-confidence')).toHaveText('88%');
    const img = page.getByTestId('camera').locator('img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { message: '영상(Mock 사진)이 로드된다' }).toBe(1280);
    await page.getByRole('button', { name: '로봇 목록으로' }).click();
    await expect(page.getByTestId('robot-list')).toBeVisible();
    app.expectClean();
  });

  test('UI-06: 전체 긴급정지는 모든 로봇을, 로봇별 정지는 그 로봇만 멈춘다. 재개하면 승인 대기로', async ({ page }) => {
    const app = await openApp(page);
    for (const cell of CELLS) await expect(rowState(page, cell)).toHaveAttribute('data-state', 'proposed');
    await page.getByTestId('btn-estop-all').click();
    for (const cell of CELLS) await expect(rowState(page, cell), `${cell} 전체 정지`).toHaveAttribute('data-state', 'estopped');
    await expect(page.getByTestId('alarm-list')).toHaveAttribute('data-count', '2');
    await page.getByTestId('btn-resume-all').click();
    for (const cell of CELLS) await expect(rowState(page, cell)).toHaveAttribute('data-state', 'proposed');
    await expect(page.getByTestId('alarm-list')).toHaveAttribute('data-count', '0');

    await rowState(page, 'spider-2').click();
    await page.getByTestId('btn-estop').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'estopped');
    await page.getByRole('button', { name: '로봇 목록으로' }).click();
    await expect(rowState(page, 'spider-1'), '다른 로봇은 그대로').toHaveAttribute('data-state', 'proposed');
    await expect(rowState(page, 'spider-2')).toHaveAttribute('data-state', 'estopped');
    const sent = await page.evaluate(() => window.__app!.sent());
    expect(sent.map((s) => [s.suffix, s.cell])).toEqual([
      ['cmd/estop', null],
      ['cmd/resume', null],
      ['cmd/estop', 'spider-2'],
    ]);
    app.expectClean();
  });

  test('UI-07: 알람을 누르면 그 로봇 패널이 열린다', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-2')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-2').click();
    await page.getByTestId('btn-estop').click();
    await page.getByRole('button', { name: '로봇 목록으로' }).click();
    await page.getByTestId('alarm-row-spider-2-estop').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-cell', 'spider-2');
    app.expectClean();
  });

  test('UI-10: 화면의 heartbeat가 끊기면 실행 중인 로봇이 일시정지(HEARTBEAT_LOST)되고, 재개하면 승인 대기로 알람이 풀린다', async ({ page }) => {
    // 실행이 끝나기 전에 끊김을 알아채게 실행은 길게, 끊김 판정은 짧게
    await mock.close();
    mock = await startMockServer({ site: SITE, url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 300, runMs: 30000, heartbeatTimeoutMs: 1500 });
    const app = await openApp(page);
    await expect(rowState(page, 'spider-1')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-1').click();
    await page.getByTestId('btn-approve').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'running');
    // 서버는 heartbeat를 한 번이라도 받은 뒤에만 끊김을 판정한다: 한 번 오는 것을 보고 끊는다
    const hb = mqtt.connect(`mqtt://localhost:${broker.tcpPort}`);
    await new Promise<void>((r) => hb.on('connect', () => hb.subscribe('innoworks/operator/+/heartbeat', () => r())));
    await new Promise<void>((r) => hb.once('message', () => r()));
    hb.end();
    await page.evaluate(() => window.__app!.setHeartbeat(false));
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'paused');
    await expect(page.getByTestId('alarm-row-spider-1-heartbeat')).toBeVisible();
    await expect(rowState(page, 'spider-2'), '실행 중이 아니던 로봇은 그대로').toHaveAttribute('data-state', 'proposed');
    await page.evaluate(() => window.__app!.setHeartbeat(true));
    await page.getByTestId('btn-resume').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'proposed');
    await expect(page.getByTestId('alarm-row-spider-1-heartbeat')).toHaveCount(0);
    app.expectClean();
  });

  test('UI-08: 브로커가 끊기면 안내 띠와 회색 트윈, 다시 붙으면 사라지고 서버가 상태를 다시 보낸다', async ({ page, browser }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    for (const cell of CELLS) await expect(rowState(page, cell)).toHaveAttribute('data-state', 'proposed');
    await expect(page.getByTestId('bus-banner')).toHaveCount(0);
    const { tcpPort, wsPort } = broker;
    await broker.close();
    await expect(page.getByTestId('bus-state')).not.toHaveAttribute('data-state', 'connected');
    await expect(page.getByTestId('bus-banner')).toBeVisible();
    await expect(page.getByTestId('app-scene')).toHaveAttribute('data-lost', '1');
    for (const cell of CELLS) await expect(rowState(page, cell), '마지막 상태를 그대로 보인다').toHaveAttribute('data-state', 'proposed');
    broker = await startBroker({ tcpPort, wsPort }); // 새 브로커(retained 없음)
    await expect(page.getByTestId('bus-state')).toHaveAttribute('data-state', 'connected', { timeout: 15000 });
    await expect(page.getByTestId('bus-banner')).toHaveCount(0);
    await expect(page.getByTestId('app-scene')).toHaveAttribute('data-lost', '0');
    // 새로 연 화면도 상태를 받는다: Mock 서버가 다시 붙으며 상태를 다시 보냈다
    const fresh = await browser.newPage();
    await openApp(fresh);
    for (const cell of CELLS) await expect(rowState(fresh, cell), `${cell} 새 화면`).toHaveAttribute('data-state', 'proposed');
    await fresh.close();
    expect(errors).toEqual([]);
  });

  test('UI-08: 로봇 서버가 비정상 종료하면 오프라인(유언)으로 보이고 버튼이 막힌다. 서버가 돌아오면 복구', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-1')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-1').click();
    await expect(page.getByTestId('btn-approve')).toBeEnabled();
    mock.kill();
    for (const cell of CELLS) await expect(rowState(page, cell)).toHaveAttribute('data-state', 'offline');
    await expect(page.getByTestId('unit-hint')).toContainText('서버와 연결이 끊겼다');
    await expect(page.getByTestId('btn-approve')).toHaveCount(0);
    await expect(page.getByTestId('bus-banner')).toContainText('로봇 서버');
    mock = await startMockServer({ site: SITE, url: `mqtt://localhost:${broker.tcpPort}`, httpPort: 0, proposeMs: 300, runMs: 2000 });
    await expect(rowState(page, 'spider-1')).not.toHaveAttribute('data-state', 'offline');
    await expect(page.getByTestId('bus-banner')).toHaveCount(0);
    app.expectClean();
  });

  test('UI-03: 영상 위 경로가 제안의 원본 픽셀 경로와 1px 안에서 맞고, 화면 크기가 바뀌어도 맞는다', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-1')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-1').click();
    // 화면 크기를 바꾼 직후에는 한 프레임 동안 옛 오버레이가 남는다 → 다시 그려질 때까지 기다렸다가 비교한다
    const errors = async () => {
      const ov = await page.evaluate(() => window.__app!.overlay('spider-1'));
      if (!ov) return null;
      const cam = (await page.getByTestId('camera').boundingBox())!;
      const px = (await page.evaluate(() => window.__app!.cells()['ship-block/spider-1'].proposal!.path_px))!;
      const scale = Math.min(cam.width / ov.frameSize[0], cam.height / ov.frameSize[1]);
      const ox = (cam.width - ov.frameSize[0] * scale) / 2;
      const oy = (cam.height - ov.frameSize[1] * scale) / 2;
      if (ov.points.length !== px.length) return { box: Infinity, point: Infinity };
      const point = Math.max(...ov.points.map(([x, y], i) => Math.hypot(x - (ox + px[i][0] * scale), y - (oy + px[i][1] * scale))));
      return { box: Math.abs(ov.box[0] - cam.width), point };
    };
    const check = async (what: string) => {
      await expect
        .poll(async () => {
          const e = await errors();
          return e !== null && e.box <= 1 && e.point <= 1;
        }, { message: `${what}: 오버레이 상자 폭과 점이 1px 안에서 맞아야 한다` })
        .toBe(true);
      const e = (await errors())!;
      expect(e.box, `${what}: 상자 폭`).toBeLessThanOrEqual(1);
      expect(e.point, `${what}: 점`).toBeLessThanOrEqual(1);
    };
    await check('노트북');
    await page.setViewportSize({ width: 820, height: 1180 });
    await check('세로');
    app.expectClean();
  });

  test('UI-04: 승인 → 실행(진행률) → 완료 → 합격 → 새 제안. 보낸 직후에는 화면이 바뀌지 않고 응답을 기다린다', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-1')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-1').click();
    const panel = page.getByTestId('unit-panel');
    const firstTask = await page.getByTestId('unit-task').textContent();
    await expect(page.getByTestId('btn-approve')).toBeEnabled();
    await expect(page.getByTestId('btn-edit')).toBeEnabled();
    // 보낸 직후: 상태는 그대로, 기다림 표시(서버 응답 전에는 화면을 바꾸지 않는다)
    const right = await page.evaluate(() => {
      (document.querySelector('[data-testid="btn-approve"]') as HTMLButtonElement).click();
      const p = document.querySelector('[data-testid="unit-panel"]') as HTMLElement;
      return p.dataset.state;
    });
    expect(right, '누른 순간에는 아직 승인 대기').toBe('proposed');
    await expect(panel).toHaveAttribute('data-state', 'running');
    await expect(panel).toHaveAttribute('data-pending', '0');
    await expect(page.getByTestId('btn-approve')).toHaveCount(0);
    await expect.poll(async () => Number((await page.getByTestId('unit-progress').textContent())!.replace('%', ''))).toBeGreaterThan(0);
    await expect(panel).toHaveAttribute('data-state', 'completed');
    await expect(page.getByTestId('unit-progress')).toHaveText('100%');
    await page.getByTestId('btn-confirm-ok').click();
    await expect(panel).toHaveAttribute('data-state', 'idle');
    await expect(panel, '대기 뒤 새 제안').toHaveAttribute('data-state', 'proposed');
    expect(await page.getByTestId('unit-task').textContent()).not.toBe(firstTask);
    const sent = (await page.evaluate(() => window.__app!.sent())).map((x) => x.suffix);
    expect(sent).toEqual(['cmd/approve', 'cmd/confirm']);
    app.expectClean();
  });

  test('UI-04: 재작업이면 같은 용접선을 새 작업으로 다시 제안한다', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-2')).toHaveAttribute('data-state', 'proposed');
    await rowState(page, 'spider-2').click();
    const before = await page.evaluate(() => window.__app!.cells()['ship-block/spider-2'].proposal!.path_px);
    const firstTask = await page.getByTestId('unit-task').textContent();
    await page.getByTestId('btn-approve').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'completed');
    await page.getByTestId('btn-confirm-rework').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'proposed');
    expect(await page.getByTestId('unit-task').textContent()).not.toBe(firstTask);
    expect(await page.evaluate(() => window.__app!.cells()['ship-block/spider-2'].proposal!.path_px)).toEqual(before);
    app.expectClean();
  });

  test('UI-04: 지난 작업에 대한 명령은 서버가 거부하고 알람(cmd_id)이 목록에 뜬다', async ({ page }) => {
    const app = await openApp(page);
    await expect(rowState(page, 'spider-1')).toHaveAttribute('data-state', 'proposed');
    const c = mqtt.connect(`mqtt://localhost:${broker.tcpPort}`);
    await new Promise<void>((r) => c.on('connect', () => r()));
    const cmd = { v: 1, ts: Date.now(), cmd_id: 'stale000-0001', operator: 'op-test', task_id: 't-old' };
    await new Promise<void>((r) => c.publish(`innoworks/${SITE}/spider-1/cmd/approve`, JSON.stringify(cmd), { qos: 1 }, () => r()));
    c.end();
    await expect(page.getByTestId('alarm-list')).toHaveAttribute('data-count', '1');
    const alarm = await page.evaluate(() => Object.values(window.__app!.cells()['ship-block/spider-1'].alarms)[0]);
    expect(alarm).toMatchObject({ code: 'CMD_REJECTED', cmd_id: 'stale000-0001' });
    await expect(rowState(page, 'spider-1'), '상태는 그대로').toHaveAttribute('data-state', 'proposed');
    app.expectClean();
  });

  /** 패널 영상 위 경로 점(페이지 좌표)과 영상 상자 */
  async function seamOnScreen(page: Page, cell: string) {
    const cam = (await page.getByTestId('camera').boundingBox())!;
    const ov = (await page.evaluate((c) => window.__app!.overlay(c), cell))!;
    return { cam, ov, page: ov.points.map(([x, y]) => [cam.x + x, cam.y + y] as [number, number]) };
  }

  async function startEdit(page: Page, cell: string) {
    await expect(rowState(page, cell)).toHaveAttribute('data-state', 'proposed');
    await rowState(page, cell).click();
    await page.getByTestId('btn-edit').click();
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'editing');
    await expect(page.getByTestId('camera')).toHaveAttribute('data-mode', 'edit');
    await expect(page.getByTestId('camera')).toHaveAttribute('data-src', new RegExp(`/frames/f-${cell}-`));
    await expect.poll(async () => (await page.evaluate((c) => window.__app!.overlay(c)?.mode, cell))).toBe('edit');
  }

  async function drawWithMouse(page: Page, pts: [number, number][]) {
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 6 });
    await page.mouse.up();
  }

  test('UI-05: 수정 → 멈춘 영상 위에 그리면 손을 뗄 때 cmd/drag 한 번 → 수렴 경로로 다시 승인 대기', async ({ page }) => {
    const app = await openApp(page);
    await startEdit(page, 'spider-1');
    const { page: seam, cam, ov } = await seamOnScreen(page, 'spider-1');
    const stroke = [seam[2], seam[4], seam[6], seam[8]].map(([x, y]) => [x, y + 4] as [number, number]); // 용접선 약간 아래
    await drawWithMouse(page, stroke);
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'proposed');
    const sent = await page.evaluate(() => window.__app!.sent());
    expect(sent.map((x) => x.suffix), '드래그 한 번에 명령 한 번').toEqual(['cmd/edit_start', 'cmd/drag']);
    const c = await page.evaluate(() => window.__app!.cells()['ship-block/spider-1']);
    // 수렴 결과로 새 제안이 왔다(store는 새 제안이 오면 수렴 결과를 비운다, DY-07)
    expect(c.proposal?.path_px).toHaveLength(9);
    // 수렴 경로는 그린 구간(첫 점 ~ 끝 점) 안의 용접선
    const toFrame = ([x, y]: number[]) => [(x - cam.x - ov.fit.x) / ov.fit.scale, (y - cam.y - ov.fit.y) / ov.fit.scale];
    const [x0] = toFrame(stroke[0]);
    const [x1] = toFrame(stroke[stroke.length - 1]);
    expect(c.proposal!.path_px![0][0]).toBeGreaterThan(x0 - 15);
    expect(c.proposal!.path_px![8][0]).toBeLessThan(x1 + 15);
    await expect(page.getByTestId('unit-confidence')).toHaveText('97%');
    await expect(page.getByTestId('camera'), '수정이 끝나면 다시 실시간 영상').toHaveAttribute('data-mode', 'view');
    app.expectClean();
  });

  test('UI-05: 용접선에서 먼 선은 수렴 실패(알람, 수정 중 유지) → 다시 그리면 성공', async ({ page }) => {
    const app = await openApp(page);
    await startEdit(page, 'spider-1');
    const { cam, page: seam } = await seamOnScreen(page, 'spider-1');
    await drawWithMouse(page, [
      [cam.x + cam.width * 0.2, cam.y + cam.height * 0.92],
      [cam.x + cam.width * 0.8, cam.y + cam.height * 0.92],
    ]);
    await expect(page.getByTestId('alarm-list')).toContainText('그린 선이 용접선에서 멀다');
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'editing');
    await expect.poll(async () => (await page.evaluate(() => window.__app!.overlay('spider-1')?.failed))).toBe(true);
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-pending', '0');
    await drawWithMouse(page, [seam[1], seam[5], seam[10]]);
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'proposed');
    app.expectClean();
  });

  test('UI-05: 터치로 그려도 같고, 수정 중에는 스크롤이 막힌다. 짧게 톡 친 것은 보내지 않는다', async ({ page }) => {
    const app = await openApp(page);
    await startEdit(page, 'spider-2');
    expect(await page.getByTestId('overlay').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    const { page: seam } = await seamOnScreen(page, 'spider-2');
    const touch = (type: string, [x, y]: number[]) =>
      page.getByTestId('overlay').dispatchEvent(type, { pointerType: 'touch', isPrimary: true, pointerId: 11, clientX: x, clientY: y, bubbles: true });
    // 톡: 거의 안 움직임 → 보내지 않는다
    await touch('pointerdown', seam[3]);
    await touch('pointerup', [seam[3][0] + 2, seam[3][1] + 1]);
    await page.waitForTimeout(300);
    expect((await page.evaluate(() => window.__app!.sent())).map((x) => x.suffix)).toEqual(['cmd/edit_start']);
    // 그리기
    await touch('pointerdown', seam[1]);
    for (const p of [seam[3], seam[5], seam[7], seam[9]]) await touch('pointermove', [p[0] + 3, p[1]]);
    await touch('pointerup', seam[10]);
    await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-state', 'proposed');
    expect((await page.evaluate(() => window.__app!.sent())).map((x) => x.suffix)).toEqual(['cmd/edit_start', 'cmd/drag']);
    app.expectClean();
  });
});
