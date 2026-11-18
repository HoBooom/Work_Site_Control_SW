// L3 M5: 픽스처를 MQTT 브로커로 재생해도 픽스처 재생기와 같은 상태가 된다. 브로커는 이 검사가 빈 포트에 띄운다(aedes, ADR 0004).
import { expect, test, type Page } from '@playwright/test';
import mqtt from 'mqtt';
import { startBroker, type Broker } from '../../../infra/broker.mjs';
import { playFixture, readFixture } from '../../../tools/play.mjs';
import { openLab } from './helpers';

const SITE = 'ship-block';
let broker: Broker;

test.beforeAll(async () => {
  broker = await startBroker({ tcpPort: 0, wsPort: 0 });
});
test.afterAll(async () => {
  await broker.close();
});

const tcpUrl = () => `mqtt://localhost:${broker.tcpPort}`;
const liveQuery = (extra = '') => `site=${SITE}&source=mqtt&broker=ws://localhost:${broker.wsPort}&hud=0${extra}`;
const state = (page: Page) => page.evaluate(() => window.__twin!.state());

/** 이전 검사가 남긴 retained 상태를 비운다(브로커는 검사 파일 하나 동안 살아 있다) */
async function clearRetained(name: string) {
  await (await playFixture(readFixture(name), { url: tcpUrl(), until: -1 })).end();
}

async function openLive(page: Page, extra = '') {
  const lab = await openLab(page, liveQuery(extra));
  await expect.poll(async () => (await state(page)).bus?.state, { message: '브로커에 붙는다' }).toBe('connected');
  return lab;
}

/** 수신 시각(at)을 뺀 셀 상태. 픽스처 재생과 브로커 재생을 비교한다 */
function normalize(cells: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(cells).map(([k, c]) => [
      k,
      { ...c, jointSamples: (c.jointSamples as { ts: number; joints: unknown; base?: unknown; contacts?: unknown }[]).map(({ ts, joints, base, contacts }) => ({ ts, joints, base, contacts })) },
    ]),
  );
}

test.describe('MQTT 브로커 @L3', () => {
  for (const [name, times] of [
    ['ship-block-basic', [1000, 4300, 9000]],
    ['ship-block-edit', [2600, 5000]],
    ['ship-block-alarm', [3200, 4000, 6000]],
    ['ship-block-offline', [4500, 7000]],
    ['ship-block-stale', [4500, 7500]],
  ] as const) {
    test(`M5 ${name}: 브로커로 재생한 상태가 픽스처 재생과 같다`, async ({ page }) => {
      const lines = readFixture(name);
      for (const t of times) {
        let lab = await openLab(page, `site=${SITE}&fixture=${name}&t=${t}&freeze=1&hud=0`);
        const expected = normalize((await state(page)).cells as never);
        lab.expectClean();

        await clearRetained(name);
        lab = await openLive(page);
        const p = await playFixture(lines, { url: tcpUrl(), instant: true, until: t, keepTs: true });
        try {
          await expect.poll(async () => (await state(page)).bus?.received, { message: `t=${t} 모두 받는다` }).toBe(p.sent);
          expect(normalize((await state(page)).cells as never), `t=${t}`).toEqual(expected);
        } finally {
          await p.end();
        }
        lab.expectClean();
      }
    });
  }

  test('M5 retained: 화면을 늦게 열어도 지금 상태(작업·경로·연결)가 보인다', async ({ page }) => {
    await clearRetained('ship-block-basic');
    const p = await playFixture(readFixture('ship-block-basic'), { url: tcpUrl(), instant: true, until: 5000, keepTs: true });
    const lab = await openLive(page);
    await expect.poll(async () => (await state(page)).cells[`${SITE}/spider-1`]?.task?.state).toBe('running');
    const c = (await state(page)).cells[`${SITE}/spider-1`];
    expect(c.online).toBe(true);
    expect(c.proposal?.surface).toBe('bottom-shell');
    expect(await page.evaluate(() => window.__twin!.seam('ship-block', 'spider-1')), '용접선이 그려진다').not.toBeNull();
    await p.end();
    lab.expectClean();
  });

  test('M5 LWT: 서버(재생기)가 비정상 종료하면 브로커가 offline을 보내 셀이 회색이 된다', async ({ page }) => {
    await clearRetained('ship-block-basic');
    const lab = await openLive(page);
    const p = await playFixture(readFixture('ship-block-basic'), { url: tcpUrl(), instant: true, until: 4000, keepTs: true });
    await expect.poll(async () => (await page.evaluate(() => window.__twin!.view('ship-block', 'spider-1'))).lamp?.state).toBe('running');
    p.kill();
    await expect.poll(async () => (await page.evaluate(() => window.__twin!.view('ship-block', 'spider-1'))).lamp?.state, { message: '유언 offline' }).toBe('offline');
    expect((await page.evaluate(() => window.__twin!.view('ship-block', 'spider-1'))).robotGray).toBe(true);
    lab.expectClean();
  });

  test('M5 계약에 맞지 않는 메시지는 버리고 경고한다', async ({ page }) => {
    await clearRetained('ship-block-basic');
    const lab = await openLive(page);
    const c = mqtt.connect(tcpUrl());
    await new Promise<void>((r) => c.on('connect', () => r()));
    await new Promise<void>((r) => c.publish(`innoworks/${SITE}/spider-1/robot/state`, JSON.stringify({ v: 1, ts: 1 }), { qos: 1 }, () => r()));
    await new Promise<void>((r) => c.publish(`innoworks/${SITE}/spider-1/status`, 'not json', { qos: 1 }, () => r()));
    await expect.poll(async () => (await state(page)).bus?.dropped).toBe(2);
    expect((await state(page)).cells[`${SITE}/spider-1`], '버린 메시지는 store에 들어가지 않는다').toBeUndefined();
    c.end();
    expect(lab.problems.filter((m) => m.includes('[bus]'))).toHaveLength(2);
    expect(lab.problems.filter((m) => !m.includes('[bus]')), '다른 경고는 없다').toEqual([]);
  });

  test('M5 실시간 재생: 로봇이 걸어가고 작업이 끝난다(4배속)', async ({ page }) => {
    await clearRetained('ship-block-weld');
    const lab = await openLive(page);
    const robotX = async () => (await page.evaluate(() => window.__twin!.object('ship-block', 'spider-1', 'robot'))).position![0];
    const x0 = await robotX();
    const p = await playFixture(readFixture('ship-block-weld'), { url: tcpUrl(), speed: 4 });
    expect((await robotX()) - x0, '걸어서 작업 위치로 갔다').toBeGreaterThan(0.5);
    await expect.poll(async () => (await state(page)).cells[`${SITE}/spider-1`]?.task?.state).toBe('completed');
    await p.end();
    lab.expectClean();
  });

  test('M5 관제 화면(/): 브로커에 붙어 받은 상태로 트윈을 그린다', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/React DevTools|THREE\.Clock/.test(m.text()) && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(e.message));
    await clearRetained('ship-block-basic');
    await page.goto(`/?site=${SITE}&broker=ws://localhost:${broker.wsPort}`);
    await expect(page.getByTestId('bus-state')).toHaveAttribute('data-state', 'connected');
    const p = await playFixture(readFixture('ship-block-basic'), { url: tcpUrl(), instant: true, until: 4000, keepTs: true });
    await expect(page.getByTestId('bus-state').locator('xpath=..')).toContainText(`받은 메시지 ${p.sent}`);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByTestId(`cell-label-${SITE}-spider-1`)).toContainText('실행 중');
    await p.end();
    expect(problems).toEqual([]);
  });
});
