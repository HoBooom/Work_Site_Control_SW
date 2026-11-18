// L3 로봇 랩(/lab/robot): 로봇 URDF가 메시까지 다 뜨고, 4족 로봇은 0° 자세에서 네 발판이 바닥(또는 벽)에 평평하게 닿는다.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openRobotLab } from './helpers';

const robotDir = new URL('../../assets/robot/', import.meta.url);
const ROBOTS = readdirSync(robotDir).filter((d) => !d.startsWith('.')).sort();
const urdf = (name: string) => readFileSync(new URL(`${name}/robot.urdf`, robotDir), 'utf8');
/** 형상(visual)이 있는 링크 수 */
const visualLinks = (name: string) => [...urdf(name).matchAll(/<link name="[^"]+">\s*<visual>/g)].length;
/** 링크 메시 STL 삼각형 합(바이너리 STL: 80바이트 머리말 뒤 uint32) */
const stlTriangles = (name: string) =>
  [...urdf(name).matchAll(/<mesh filename="([^"]+)"/g)]
    .map((m) => readFileSync(new URL(`${name}/${m[1]}`, robotDir)).readUInt32LE(80))
    .reduce((a, b) => a + b, 0);
const SPIDER = 'spider-welder';
const LEGS = ['fl', 'fr', 'rl', 'rr'];
const MM = 0.001;

const lab = (page: Page) => ({
  state: () => page.evaluate(() => window.__robotLab!.state()),
  box: (link?: string, own = false) => page.evaluate(([l, o]) => window.__robotLab!.box(l, o), [link, own] as const),
  frame: (link: string) => page.evaluate((l) => window.__robotLab!.frame(l), link),
  setJoints: (j: Record<string, number>) => page.evaluate((jj) => window.__robotLab!.setJoints(jj), j),
});

test.describe('로봇 랩 @L3', () => {
  for (const name of ROBOTS) {
    test(`${name}: 링크마다 메시 하나로 그리고(드로우 콜), STL 삼각형은 모두 남는다`, async ({ page }) => {
      const session = await openRobotLab(page, `robot=${name}&panel=0`);
      const s = await lab(page).state();
      expect(s.robot).toBe(name);
      // 링크 안의 재질별 메시를 하나로 합친다(Robot.tsx mergeLinks). 링크가 따로 움직이므로 링크보다 줄일 수는 없다
      expect(s.meshes, '메시 수 = 형상이 있는 링크 수').toBe(visualLinks(name));
      expect(s.triangles, '삼각형 수 = STL 합').toBe(stlTriangles(name));
      session.expectClean();
    });
  }

  test(`${SPIDER}: 관절 이름(다리 4×5, 팔 6)`, async ({ page }) => {
    const session = await openRobotLab(page, `robot=${SPIDER}&panel=0`);
    const names = (await lab(page).state()).meta.map((j) => j.name).sort();
    const expected = [
      ...LEGS.flatMap((l) => ['hip_yaw', 'hip_pitch', 'knee', 'ankle_pitch', 'ankle_roll'].map((j) => `${l}_${j}`)),
      ...[1, 2, 3, 4, 5, 6].map((i) => `arm_${i}`),
    ].sort();
    expect(names).toEqual(expected);
    session.expectClean();
  });

  test(`${SPIDER}: 0° 자세에서 네 발판이 바닥에 평평하게 닿고 몸통은 떠 있다`, async ({ page }) => {
    const session = await openRobotLab(page, `robot=${SPIDER}&panel=0&mount=floor`);
    for (const leg of LEGS) {
      const b = await lab(page).box(`${leg}_foot`);
      expect(b.min[2], `${leg} 발판 바닥 높이`).toBeGreaterThanOrEqual(-0.5 * MM);
      expect(b.min[2], `${leg} 발판 바닥 높이`).toBeLessThanOrEqual(2 * MM);
      const f = await lab(page).frame(`${leg}_foot`);
      expect(f.z[2], `${leg} 발판이 수평`).toBeGreaterThan(0.9999);
    }
    const body = await lab(page).box('base_link', true);
    expect(body.min[2], '몸통 아래가 바닥에서 떠 있다').toBeGreaterThan(0.02);
    expect((await lab(page).box('torch', true)).min[2], '토치가 바닥 위').toBeGreaterThan(0.2);
    // 발이 몸통을 둘러싼다(앞·뒤·좌·우)
    const feet = await Promise.all(LEGS.map((l) => lab(page).frame(`${l}_foot`)));
    expect(Math.min(...feet.map((f) => f.origin[0]))).toBeLessThan(body.min[0]);
    expect(Math.max(...feet.map((f) => f.origin[0]))).toBeGreaterThan(body.max[0]);
    expect(Math.min(...feet.map((f) => f.origin[1]))).toBeLessThan(body.min[1]);
    expect(Math.max(...feet.map((f) => f.origin[1]))).toBeGreaterThan(body.max[1]);
    session.expectClean();
  });

  test(`${SPIDER}: 관절을 움직이면 그 다리만 움직인다`, async ({ page }) => {
    const session = await openRobotLab(page, `robot=${SPIDER}&panel=0`);
    const before = await Promise.all(LEGS.map((l) => lab(page).frame(`${l}_foot`)));
    await lab(page).setJoints({ fl_hip_pitch: -20, fl_knee: 30 });
    const after = await Promise.all(LEGS.map((l) => lab(page).frame(`${l}_foot`)));
    const moved = before.map((b, i) => Math.hypot(...b.origin.map((v, k) => v - after[i].origin[k])));
    expect(moved[0], 'fl 발').toBeGreaterThan(0.05);
    moved.slice(1).forEach((m, i) => expect(m, `${LEGS[i + 1]} 발은 그대로`).toBeLessThan(1e-6));
    session.expectClean();
  });

  test(`${SPIDER}: 벽에 붙이면 네 발판이 벽 면에 평평하게 닿는다`, async ({ page }) => {
    const session = await openRobotLab(page, `robot=${SPIDER}&panel=0&mount=wall`);
    for (const leg of LEGS) {
      const b = await lab(page).box(`${leg}_foot`);
      expect(b.max[1], `${leg} 발판이 벽 면(y=0)에`).toBeGreaterThanOrEqual(-2 * MM);
      expect(b.max[1]).toBeLessThanOrEqual(0.5 * MM);
      const f = await lab(page).frame(`${leg}_foot`);
      expect(f.z[1], `${leg} 발판이 벽과 평행`).toBeLessThan(-0.9999);
    }
    expect((await lab(page).box()).min[2], '로봇 전체가 바닥 위').toBeGreaterThan(0);
    session.expectClean();
  });
});
