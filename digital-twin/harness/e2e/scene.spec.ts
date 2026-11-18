// L3 씬(조선소 블록 ship-block): 관절 추종, 다중 로봇, 면 위 용접선, 카메라 제한, 로딩·실패.
// 작업판·로봇 기준점·프리셋은 사이트마다 같은 기준으로 sites.spec.ts가 본다.
import { expect, test, type Page } from '@playwright/test';
import { CAMERA_MAX_DISTANCE_M } from '../../../frontend/src/scene/camera-limits';
import { siteBounds } from '../../../frontend/src/scene/bounds';
import { INTERP_DELAY_MS } from '../../../frontend/src/scene/joints';
import { pathPointToSite } from '../../../frontend/src/scene/surface';
import { expectedJoints, fixture, siteConfig } from './data';
import { openLab } from './helpers';

const SITE = 'ship-block';
const config = siteConfig(SITE);
const weld = fixture('ship-block-basic');
const [C1, C2] = config.cells;
const MM = 0.001;

const twin = (page: Page) => ({
  joints: (cell: string) => page.evaluate(([s, c]) => window.__twin!.joints(s, c), [SITE, cell] as const),
  seam: (cell: string) => page.evaluate(([s, c]) => window.__twin!.seam(s, c), [SITE, cell] as const),
  camera: () => page.evaluate(() => window.__twin!.camera()),
  goto: (t: number) =>
    page.evaluate(async (tt) => {
      window.__twin!.setClock(tt);
      await window.__twin!.frames(2);
    }, t),
});

test.describe('씬 @L3', () => {
  test('DY-01: 렌더 관절각이 픽스처 보간값과 0.5° 이내(지연 ≤ 150ms)', async ({ page }) => {
    expect(INTERP_DELAY_MS).toBeLessThanOrEqual(150);
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=2550&freeze=1`);
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

  test('DY-02: 두 로봇이 각자의 픽스처를 따라 따로 움직인다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=5000&freeze=1`);
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

  test('DY-03: 용접선의 각 점이 면 좌표 변환과 2mm 이내(면 위 1.5mm에 그린다)', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=0&freeze=1`);
    expect(await twin(page).seam(C1.id), '제안 전에는 선이 없다').toBeNull();
    await twin(page).goto(1000);
    const proposal = weld.find((l) => l.topic.endsWith(`${C1.id}/task/proposal`))!.payload as { path: [number, number][]; surface?: string };
    const seam = (await twin(page).seam(C1.id))!.points;
    expect(seam).toHaveLength(proposal.path.length);
    seam.forEach((p, i) => {
      const e = pathPointToSite(config, C1, proposal.surface, proposal.path[i]);
      expect(Math.hypot(...p.map((v, k) => v - e[k])), `점 ${i}`).toBeLessThanOrEqual(2 * MM);
    });
    expect(await twin(page).seam(C2.id), '스파이더 2는 작업이 없다').toBeNull();
    lab.expectClean();
  });

  test('IX-01: 어떤 조작으로도 카메라가 사이트 밖·바닥 아래로 가지 않는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-idle&t=0&freeze=1&hud=0`);
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
    await page.goto(`/lab?site=${SITE}&fixture=ship-block-idle&freeze=1`);
    await expect(page.getByTestId('scene-loading')).toContainText('3D 장면 불러오는 중');
    await page.waitForFunction(() => !!window.__twin);
    await page.evaluate(() => window.__twin!.ready());
    await expect(page.getByTestId('scene-loading')).toBeHidden();
  });

  test('RD-01: 에셋을 못 불러오면 이유가 화면에 나오고 ready가 거부된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.route('**/sites/*.glb', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto(`/lab?site=${SITE}&fixture=ship-block-idle&freeze=1`);
    await page.waitForFunction(() => !!window.__twin);
    const rejected = await page.evaluate(() => window.__twin!.ready().then(() => null, (e: Error) => e.message));
    expect(rejected).toContain('ship-block.glb');
    await expect(page.getByTestId('scene-error')).toContainText('3D 장면을 불러오지 못했다');
    expect(errors.some((e) => e.includes('[twin-lab]'))).toBe(true);
  });
});
