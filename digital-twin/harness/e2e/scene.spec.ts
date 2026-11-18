// L3 씬 상태(M1): 에셋 연결, 작업판, 관절 추종, 다중 셀, 용접선, 카메라, 로딩·실패.
import { expect, test, type Page } from '@playwright/test';
import { CAMERA_MAX_DISTANCE_M } from '../../../frontend/src/scene/camera-limits';
import { siteBounds } from '../../../frontend/src/scene/bounds';
import { plateToSite } from '../../../frontend/src/scene/plate';
import { INTERP_DELAY_MS } from '../../../frontend/src/scene/joints';
import { expectedJoints, fixture, siteConfig } from './data';
import { openLab } from './helpers';

const SITE = 'shipyard';
const config = siteConfig(SITE);
const weld = fixture('weld-basic');
const [C1, C2] = config.cells;
const MM = 0.001;

function expectClose(actual: number[] | null, expected: number[], tol: number, what: string) {
  expect(actual, what).not.toBeNull();
  actual!.forEach((v, i) => expect(Math.abs(v - expected[i]), `${what}[${i}] ${v} vs ${expected[i]}`).toBeLessThanOrEqual(tol));
}

const twin = (page: Page) => ({
  object: (cell: string, part: 'cell' | 'plate' | 'robot' | 'seam') =>
    page.evaluate(([c, p]) => window.__twin!.object('shipyard', c, p as 'plate'), [cell, part] as const),
  joints: (cell: string) => page.evaluate((c) => window.__twin!.joints('shipyard', c), cell),
  seam: (cell: string) => page.evaluate((c) => window.__twin!.seam('shipyard', c), cell),
  camera: () => page.evaluate(() => window.__twin!.camera()),
  goto: (t: number) =>
    page.evaluate(async (tt) => {
      window.__twin!.setClock(tt);
      await window.__twin!.frames(2);
    }, t),
});

test.describe('씬 @L3', () => {
  test('AS-03, SC-02: 작업판 위치·크기가 site-config와 같다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=idle&t=0&freeze=1`);
    for (const cell of config.cells) {
      const plate = await twin(page).object(cell.id, 'plate');
      expect(plate.exists && plate.visible).toBe(true);
      // 판 그룹 원점 = 판 좌표 (0,0) 윗면
      expectClose(plate.position, plateToSite(cell, [0, 0]), 0.1 * MM, `${cell.id} 판 원점`);
      const [w, h] = cell.plate.size_mm.map((v) => v * MM);
      expectClose(plate.size!.slice(0, 2), [w, h], 0.1 * MM, `${cell.id} 판 크기`);
    }
    lab.expectClean();
  });

  test('PL-04: 로봇은 셀마다 URDF로 그린다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=idle&t=0&freeze=1`);
    for (const cell of config.cells) {
      const robot = await twin(page).object(cell.id, 'robot');
      expect(robot.exists && robot.visible, cell.id).toBe(true);
      // 링크 메시까지 그려졌는지: 관절만 있고 메시가 없으면 크기가 없다(M3-b에서 찾은 버그)
      expect(robot.size, `${cell.id} 로봇 메시`).not.toBeNull();
      expect(robot.size![2], `${cell.id} 로봇 높이(m)`).toBeGreaterThan(1.0);
      const cellObj = await twin(page).object(cell.id, 'cell');
      // 로봇 기준점 = 셀 원점 + robot.pose (셀 회전 0 가정이 아니라 위치 차이만 비교)
      const [cx, cy, cz] = cellObj.position!;
      const yaw = (cell.pose.yaw_deg * Math.PI) / 180;
      const [rx, ry, rz] = cell.robot.pose.position_m;
      expectClose(robot.position, [cx + Math.cos(yaw) * rx - Math.sin(yaw) * ry, cy + Math.sin(yaw) * rx + Math.cos(yaw) * ry, cz + rz], 0.1 * MM, `${cell.id} 로봇 기준점`);
      expect(Object.keys((await twin(page).joints(cell.id)) ?? {}).sort()).toEqual(['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6']);
    }
    lab.expectClean();
  });

  test('DY-01: 렌더 관절각이 픽스처 보간값과 0.5° 이내(지연 ≤ 150ms)', async ({ page }) => {
    expect(INTERP_DELAY_MS).toBeLessThanOrEqual(150);
    const lab = await openLab(page, `site=${SITE}&fixture=weld-basic&t=2550&freeze=1`);
    for (const t of [2550, 3333, 4071, 6000, 8460, 1500]) {
      await twin(page).goto(t);
      const expected = expectedJoints(weld, SITE, C1.id, t - INTERP_DELAY_MS);
      const actual = (await twin(page).joints(C1.id))!;
      for (const [name, v] of Object.entries(expected)) {
        expect(Math.abs(actual[name] - v), `t=${t} ${name}: ${actual[name]} vs ${v}`).toBeLessThanOrEqual(0.5);
      }
    }
    lab.expectClean();
  });

  test('DY-02: 두 셀이 각자의 픽스처를 따라 따로 움직인다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=weld-basic&t=5000&freeze=1`);
    const j1 = (await twin(page).joints(C1.id))!;
    const j2 = (await twin(page).joints(C2.id))!;
    const e1 = expectedJoints(weld, SITE, C1.id, 5000 - INTERP_DELAY_MS);
    const e2 = expectedJoints(weld, SITE, C2.id, 5000 - INTERP_DELAY_MS);
    // 픽스처가 정말 다른지(관절 하나는 우연히 같을 수 있어 전체 최대 차이로 본다)
    expect(Math.max(...Object.keys(e1).map((n) => Math.abs(e1[n] - e2[n])))).toBeGreaterThan(1);
    for (const n of Object.keys(e1)) {
      expect(Math.abs(j1[n] - e1[n]), `${C1.id} ${n}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(j2[n] - e2[n]), `${C2.id} ${n}`).toBeLessThanOrEqual(0.5);
    }
    lab.expectClean();
  });

  test('DY-03: 용접선의 각 점이 판 좌표 변환과 1mm 이내', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=weld-basic&t=0&freeze=1`);
    expect(await twin(page).seam(C1.id), '제안 전에는 선이 없다').toBeNull();
    await twin(page).goto(1000);
    const proposal = weld.find((l) => l.topic.endsWith(`${C1.id}/task/proposal`))!.payload as { path: [number, number][] };
    const seam = (await twin(page).seam(C1.id))!.points;
    expect(seam).toHaveLength(proposal.path.length);
    seam.forEach((p, i) => expectClose(p.slice(0, 2), plateToSite(C1, proposal.path[i]).slice(0, 2), 1 * MM, `점 ${i}`));
    // 높이는 판 윗면 바로 위(2mm 이내)
    seam.forEach((p) => expect(p[2] - C1.plate.pose.position_m[2]).toBeGreaterThanOrEqual(0));
    seam.forEach((p) => expect(p[2] - C1.plate.pose.position_m[2]).toBeLessThanOrEqual(2 * MM));
    expect(await twin(page).seam(C2.id), '셀 2는 작업이 없다').toBeNull();
    lab.expectClean();
  });

  test('IX-01: 어떤 조작으로도 카메라가 사이트 밖·바닥 아래로 가지 않는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=idle&t=0&freeze=1&hud=0`);
    const b = siteBounds(config);
    const check = async (what: string) => {
      const cam = await twin(page).camera();
      expect(cam.distance, `${what}: 거리`).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE_M + 1e-3);
      expect(cam.position[2], `${what}: 카메라 높이`).toBeGreaterThan(0);
      cam.target.forEach((v, i) => {
        expect(v, `${what}: 목표[${i}]`).toBeGreaterThanOrEqual(b.min[i] - 1e-3);
        expect(v, `${what}: 목표[${i}]`).toBeLessThanOrEqual(b.max[i] + 1e-3);
      });
    };
    const { mouse } = page;
    const drag = async (button: 'left' | 'right', dx: number, dy: number, times: number) => {
      for (let i = 0; i < times; i++) {
        await mouse.move(640, 360);
        await mouse.down({ button });
        await mouse.move(640 + dx, 360 + dy, { steps: 8 });
        await mouse.up({ button });
      }
    };
    for (let i = 0; i < 20; i++) await mouse.wheel(0, 2000);
    await check('끝까지 축소');
    await drag('left', 0, -600, 4); // 아래에서 올려다보기 시도
    await check('아래로 회전');
    await drag('right', 900, 0, 8);
    await check('오른쪽 끝까지 이동');
    await drag('right', -900, 500, 16);
    await check('반대쪽 끝까지 이동');
    for (let i = 0; i < 20; i++) await mouse.wheel(0, -2000);
    await check('끝까지 확대');
    lab.expectClean();
  });

  test('RD-01: 로딩 중에는 진행률이 보인다', async ({ page }) => {
    await page.route('**/sites/*.glb', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`/lab?site=${SITE}&fixture=idle&freeze=1`);
    await expect(page.getByTestId('scene-loading')).toContainText('3D 장면 불러오는 중');
    await page.waitForFunction(() => !!window.__twin);
    await page.evaluate(() => window.__twin!.ready());
    await expect(page.getByTestId('scene-loading')).toBeHidden();
  });

  test('RD-01: 에셋을 못 불러오면 이유가 화면에 나오고 ready가 거부된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.route('**/sites/*.glb', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto(`/lab?site=${SITE}&fixture=idle&freeze=1`);
    await page.waitForFunction(() => !!window.__twin);
    const rejected = await page.evaluate(() => window.__twin!.ready().then(() => null, (e: Error) => e.message));
    expect(rejected).toContain('shipyard.glb');
    await expect(page.getByTestId('scene-error')).toContainText('3D 장면을 불러오지 못했다');
    expect(errors.some((e) => e.includes('[twin-lab]'))).toBe(true);
  });
});
