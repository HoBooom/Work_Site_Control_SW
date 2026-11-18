// L3 이동 로봇(ADR 0003): 조선소 블록 내부(ship-block). 로봇이 robot/state.base를 따라 움직이고, 발이 강판에 닿고,
// 용접선은 경로가 가리키는 면(surface) 위에 그려지며, 실행 중 토치 끝이 그 용접선을 따라간다.
import { expect, test, type Page } from '@playwright/test';
import { INTERP_DELAY_MS } from '../../../frontend/src/scene/joints';
import { findSurface, surfaceToSite } from '../../../frontend/src/scene/surface';
import { fixture, siteConfig, type Line } from './data';
import { openLab } from './helpers';

const SITE = 'ship-block';
const config = siteConfig(SITE);
const weld = fixture('ship-block-weld');
const LEGS = ['fl', 'fr', 'rl', 'rr'];
const MM = 0.001;
type V3 = [number, number, number];

interface Base {
  position_m: V3;
  orientation_xyzw: [number, number, number, number];
  surface: string | null;
}

/** 픽스처의 base를 시각 r에서 위치만 선형 보간(씬과 별개로 계산) */
function expectedBase(lines: Line[], cell: string, r: number): Base {
  const s = lines.filter((l) => l.topic === `innoworks/${SITE}/${cell}/robot/state`) as (Line & { payload: { base: Base } })[];
  if (r <= s[0].t) return s[0].payload.base;
  const i = s.findIndex((x, k) => x.t <= r && s[k + 1]?.t > r);
  if (i < 0) return s[s.length - 1].payload.base;
  const [a, b] = [s[i], s[i + 1]];
  const k = (r - a.t) / (b.t - a.t);
  const p = a.payload.base.position_m.map((v, n) => v + (b.payload.base.position_m[n] - v) * k) as V3;
  return { ...a.payload.base, position_m: p };
}

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
/** 점과 AABB 사이 거리 */
const boxDist = (p: number[], b: { min: number[]; max: number[] }) =>
  Math.hypot(...p.map((v, i) => Math.max(b.min[i] - v, 0, v - b.max[i])));

const twin = (page: Page) => ({
  goto: (t: number) =>
    page.evaluate(async (tt) => {
      window.__twin!.setClock(tt);
      await window.__twin!.frames(2);
    }, t),
  object: (cell: string, part: 'robot' | 'lamp') => page.evaluate(([c, p]) => window.__twin!.object('ship-block', c, p as 'robot'), [cell, part] as const),
  link: (cell: string, link: string) => page.evaluate(([c, l]) => window.__twin!.link('ship-block', c, l), [cell, link] as const),
  seam: (cell: string) => page.evaluate((c) => window.__twin!.seam('ship-block', c), cell),
});

test.describe('이동 로봇 @L3', () => {
  test('사이트: 이동 로봇 셀은 작업판이 없고, 용접선이 놓일 면(surfaces)이 있다', () => {
    expect(config.cells.every((c) => !c.plate)).toBe(true);
    expect(config.surfaces?.map((s) => s.id).sort()).toEqual(['bottom-shell', 'side-shell']);
  });

  test('걷는 동안 로봇·상태 비콘이 robot/state.base를 따라간다(1mm)', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=0&freeze=1&hud=0`);
    const xs: number[] = [];
    for (const t of [300, 1240, 2010, 2870, 3650]) {
      await twin(page).goto(t);
      const exp = expectedBase(weld, 'spider-1', t - INTERP_DELAY_MS);
      const robot = await twin(page).object('spider-1', 'robot');
      expect(dist(robot.position!, exp.position_m), `t=${t} 로봇 위치`).toBeLessThanOrEqual(1 * MM);
      const lamp = await twin(page).object('spider-1', 'lamp');
      expect(dist(lamp.position!, robot.position!), `t=${t} 비콘이 로봇 위`).toBeLessThan(0.3);
      xs.push(robot.position![0]);
    }
    expect(xs[xs.length - 1] - xs[0], '앞(+X)으로 걸어갔다').toBeGreaterThan(0.5);
    lab.expectClean();
  });

  test('발판이 강판에 닿는다: 스파이더 1은 바닥 외판, 스파이더 2는 측면 외판', async ({ page }) => {
    // 걸음이 끝나고(마지막 스윙 4.5s) 렌더 지연(100ms)이 지난 시각
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=5000&freeze=1&hud=0`);
    const bottom = findSurface(config, 'bottom-shell');
    const side = findSurface(config, 'side-shell');
    for (const leg of LEGS) {
      const f1 = (await twin(page).link('spider-1', `${leg}_foot`))!;
      expect(Math.abs(f1.min[2] - bottom.pose.position_m[2]), `spider-1 ${leg} 발판 바닥`).toBeLessThanOrEqual(2 * MM);
      const f2 = (await twin(page).link('spider-2', `${leg}_foot`))!;
      expect(Math.abs(f2.max[1] - side.pose.position_m[1]), `spider-2 ${leg} 발판이 벽 면`).toBeLessThanOrEqual(2 * MM);
    }
    lab.expectClean();
  });

  for (const cell of ['spider-1', 'spider-2']) {
    test(`${cell}: 용접선이 가리키는 면 위에 그려진다(1mm)`, async ({ page }) => {
      const p = weld.find((l) => l.topic === `innoworks/${SITE}/${cell}/task/proposal`)!;
      const { path, surface } = p.payload as { path: [number, number][]; surface: string };
      const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=${p.t + 200}&freeze=1&hud=0`);
      const seam = (await twin(page).seam(cell))!;
      expect(seam, '용접선').not.toBeNull();
      const s = findSurface(config, surface);
      seam.points.forEach((pt, i) => {
        const e = surfaceToSite(s, path[i]);
        expect(dist(pt, e), `점 ${i}`).toBeLessThanOrEqual(2 * MM); // 1.5mm 띄워 그린다
      });
      lab.expectClean();
    });
  }

  test('DY-12: 발마다 자석 접촉이 표시되고, 드는 발은 꺼짐으로 바뀐다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=0&freeze=1&hud=0`);
    const states = weld.filter((l) => l.topic === `innoworks/${SITE}/spider-1/robot/state`) as (Line & { payload: { contacts: Record<string, boolean> } })[];
    let sawOff = false;
    for (const t of [700, 1250, 1800, 2300, 6000]) {
      await twin(page).goto(t);
      const r = t - INTERP_DELAY_MS;
      const expected = states.filter((l) => l.t <= r).at(-1)!.payload.contacts;
      const v = await page.evaluate(() => window.__twin!.view('ship-block', 'spider-1'));
      expect(v.contacts, `t=${t}`).toEqual(expected);
      if (Object.values(v.contacts).includes(false)) sawOff = true;
      // 표시가 발판에 붙어 있다(발 링크 상자 가운데에서 15cm 이내)
      for (const leg of LEGS) {
        const f = (await twin(page).link('spider-1', `${leg}_foot`))!;
        const c = f.min.map((m, i) => (m + f.max[i]) / 2);
        expect(dist(v.contactRings[`${leg}_foot`], c), `t=${t} ${leg} 표시 위치`).toBeLessThan(0.15);
      }
      expect(v.robotGray, '접촉 표시는 로봇 색 판정에 넣지 않는다').toBe(false);
    }
    expect(sawOff, '걷는 동안 꺼진 발이 보인다').toBe(true);
    lab.expectClean();
  });

  test('IX-07: 로봇을 선택하면 카메라가 로봇을 따라가고, 선택을 풀면 멈춘다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=300&freeze=1&hud=0&preset=overview`);
    const camera = () => page.evaluate(() => window.__twin!.camera());
    const p = await page.evaluate(() => window.__twin!.screen('ship-block', 'spider-1', 'robot'));
    await page.mouse.click(p![0], p![1]);
    expect((await page.evaluate(() => window.__twin!.selection()))?.cell).toBe('spider-1');
    await twin(page).goto(400);
    const c0 = await camera();
    const r0 = (await twin(page).object('spider-1', 'robot')).position!;
    expect(c0.follow, '따라가는 대상').toEqual({ site: SITE, cell: 'spider-1' });
    await twin(page).goto(3600);
    await page.evaluate(() => window.__twin!.frames(2));
    const c1 = await camera();
    const r1 = (await twin(page).object('spider-1', 'robot')).position!;
    const moved = r1.map((v, i) => v - r0[i]);
    expect(Math.hypot(...moved), '로봇이 걸어갔다').toBeGreaterThan(0.5);
    c1.target.forEach((v, i) => expect(Math.abs(v - c0.target[i] - moved[i]), `목표[${i}]가 로봇만큼`).toBeLessThanOrEqual(1 * MM));
    c1.position.forEach((v, i) => expect(Math.abs(v - c0.position[i] - moved[i]), `카메라[${i}]가 로봇만큼`).toBeLessThanOrEqual(1 * MM));
    // 선택 해제(빈 곳 = 하늘 누르기) → 따라가지 않는다
    await page.mouse.click(640, 8);
    expect(await page.evaluate(() => window.__twin!.selection())).toBeNull();
    await twin(page).goto(500);
    await page.evaluate(() => window.__twin!.frames(2));
    const c2 = await camera();
    expect(c2.follow).toBeNull();
    expect(dist(c2.target, c1.target), '해제 뒤에는 그대로').toBeLessThanOrEqual(1 * MM);
    lab.expectClean();
  });

  test('실행 중 토치 끝이 용접선을 따라간다(2cm)', async ({ page }) => {
    const p = weld.find((l) => l.topic === `innoworks/${SITE}/spider-1/task/proposal`)!;
    const { path } = p.payload as { path: [number, number][] };
    const s = findSurface(config, 'bottom-shell');
    const progress = weld.filter((l) => l.topic.endsWith('spider-1/task/progress'));
    const [t0, t1] = [progress[0].t, progress[progress.length - 1].t];
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-weld&t=${t0}&freeze=1&hud=0`);
    for (const k of [0.1, 0.5, 0.9]) {
      const t = Math.round(t0 + (t1 - t0) * k);
      await twin(page).goto(t + INTERP_DELAY_MS);
      // 경로를 따라 k만큼 간 점(경로는 등간격 직선)
      const a = surfaceToSite(s, path[0]);
      const b = surfaceToSite(s, path[path.length - 1]);
      const target = a.map((v, i) => v + (b[i] - v) * k);
      const torch = (await twin(page).link('spider-1', 'torch'))!;
      expect(boxDist(target, torch), `진행률 ${k}: 토치 ~ 용접선`).toBeLessThanOrEqual(0.02);
      expect(torch.min[2] - s.pose.position_m[2], `진행률 ${k}: 토치가 강판 위`).toBeGreaterThan(0);
    }
    lab.expectClean();
  });
});
