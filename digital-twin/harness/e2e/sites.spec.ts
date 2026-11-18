// L3 M4: 모든 사이트가 같은 씬 코드로 뜬다. 사이트·셀 이름을 테스트에 적지 않고 site-config와 픽스처에서 읽는다.
// 사이트를 더하면(USD → build.py → 픽스처) 이 파일은 그대로 두어도 새 사이트를 검사한다.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { INTERP_DELAY_MS } from '../../../frontend/src/scene/joints';
import { plateToSite } from '../../../frontend/src/scene/plate';
import { pathPointToSite } from '../../../frontend/src/scene/surface';
import { allSites, expectedJoints, fixture, fixturesOfSite, siteConfig, type Line } from './data';
import { openLab, type Shot } from './helpers';

const MM = 0.001;
const VIEW = { w: 1280, h: 720 };
/** URDF의 움직이는 관절 이름(고정 관절 제외) */
const urdfJoints = (urdf: string) =>
  [...readFileSync(new URL(`../../assets/robot/${urdf.replace('/robots/', '')}`, import.meta.url), 'utf8').matchAll(/<joint name="([^"]+)" type="(?!fixed)/g)]
    .map((m) => m[1])
    .sort();
const SITES = allSites();
const { shots } = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8')) as { shots: Shot[] };
const budget = JSON.parse(readFileSync(new URL('../budget.json', import.meta.url), 'utf8')) as { scenes: { site: string }[] };

function expectClose(actual: number[] | null, expected: number[], tol: number, what: string) {
  expect(actual, what).not.toBeNull();
  actual!.forEach((v, i) => expect(Math.abs(v - expected[i]), `${what}[${i}] ${v} vs ${expected[i]}`).toBeLessThanOrEqual(tol));
}

/** 경로 제안이 있는 픽스처(용접선·관절 추종을 볼 수 있다) */
function weldFixtureOf(site: string): { name: string; lines: Line[] } | null {
  for (const name of fixturesOfSite(site)) {
    const lines = fixture(name);
    if (lines.some((l) => l.topic.endsWith('/task/proposal'))) return { name, lines };
  }
  return null;
}

const api = (page: Page, site: string) => ({
  object: (cell: string, part: 'cell' | 'plate' | 'robot' | 'lamp') =>
    page.evaluate(([s, c, p]) => window.__twin!.object(s, c, p as 'plate'), [site, cell, part] as const),
  screen: (cell: string, part: 'plate' | 'robot' | 'lamp') =>
    page.evaluate(([s, c, p]) => window.__twin!.screen(s, c, p as 'plate'), [site, cell, part] as const),
  joints: (cell: string) => page.evaluate(([s, c]) => window.__twin!.joints(s, c), [site, cell] as const),
  seam: (cell: string) => page.evaluate(([s, c]) => window.__twin!.seam(s, c), [site, cell] as const),
  goto: (t: number) =>
    page.evaluate(async (tt) => {
      window.__twin!.setClock(tt);
      await window.__twin!.frames(2);
    }, t),
});

test.describe('사이트 @L3', () => {
  test('M4: 사이트가 둘 이상이고, 사이트마다 픽스처·기준 장면·성능 장면이 있다', () => {
    expect(SITES.length, '조선소와 공장').toBeGreaterThanOrEqual(2);
    for (const site of SITES) {
      expect(fixturesOfSite(site).length, `${site} 픽스처`).toBeGreaterThan(0);
      expect(weldFixtureOf(site), `${site}에 경로 제안이 있는 픽스처`).not.toBeNull();
      expect(shots.some((s) => s.site === site), `${site} L4 기준 장면(shots.json)`).toBe(true);
      expect(budget.scenes.some((s) => s.site === site), `${site} L5 장면(budget.json)`).toBe(true);
    }
  });

  for (const site of SITES) {
    const config = siteConfig(site);

    test(`M4 ${site}: 배경, 셀마다 작업판·로봇·램프가 site-config대로 뜬다`, async ({ page }) => {
      const fx = fixturesOfSite(site)[0];
      const lab = await openLab(page, `site=${site}&fixture=${fx}&t=0&freeze=1&hud=0`);
      expect(await page.evaluate((s) => window.__twin!.state().site, site)).toBe(site);
      expect(await page.evaluate((s) => window.__twin!.count(`background:${s}`, 'Mesh'), site), '배경 메시').toBeGreaterThan(0);
      for (const cell of config.cells) {
        const plate = await api(page, site).object(cell.id, 'plate');
        // 작업판은 고정 로봇 셀만 갖는다. 이동 로봇(ADR 0003) 셀에는 없어야 한다
        expect(plate.exists, `${cell.id} 작업판 유무 = site-config`).toBe(!!cell.plate);
        if (cell.plate) {
          expect(plate.visible, `${cell.id} 작업판`).toBe(true);
          expectClose(plate.position, plateToSite(cell, [0, 0]), 0.1 * MM, `${cell.id} 판 원점`);
          // 판 크기: 셀·판 회전을 합친 각도로 AABB를 계산한다
          const yaw = ((cell.pose.yaw_deg + cell.plate.pose.yaw_deg) * Math.PI) / 180;
          const [w, h] = cell.plate.size_mm.map((v) => v * MM);
          const c = Math.abs(Math.cos(yaw));
          const s = Math.abs(Math.sin(yaw));
          expectClose(plate.size!.slice(0, 2), [w * c + h * s, w * s + h * c], 0.1 * MM, `${cell.id} 판 크기`);
        }

        const robot = await api(page, site).object(cell.id, 'robot');
        expect(robot.exists && robot.visible, `${cell.id} 로봇`).toBe(true);
        // 링크 메시까지 그려졌는지(관절만 있고 메시가 없으면 크기가 작다)
        expect(Math.max(...(robot.size ?? [0])), `${cell.id} 로봇 크기(m)`).toBeGreaterThan(0.5);
        // 로봇 기준점: 이동 로봇이 base를 보냈으면 그 자세, 아니면 셀·로봇 자세(ADR 0003)
        const first = fixture(fx).find((l) => l.topic === `innoworks/${site}/${cell.id}/robot/state`);
        const sent = (first?.payload as { base?: { position_m: [number, number, number] } } | undefined)?.base;
        const base = cell.pose.position_m;
        const yc = (cell.pose.yaw_deg * Math.PI) / 180;
        const [rx, ry, rz] = cell.robot.pose.position_m;
        expectClose(
          robot.position,
          sent?.position_m ?? [base[0] + Math.cos(yc) * rx - Math.sin(yc) * ry, base[1] + Math.sin(yc) * rx + Math.cos(yc) * ry, base[2] + rz],
          0.1 * MM,
          `${cell.id} 로봇 기준점`,
        );
        expect(Object.keys((await api(page, site).joints(cell.id)) ?? {}).sort()).toEqual(urdfJoints(cell.robot.urdf!));
        expect((await api(page, site).object(cell.id, 'lamp')).exists, `${cell.id} 상태 램프`).toBe(true);
      }
      lab.expectClean();
    });

    test(`M4 ${site}: 관절 추종(0.5°)과 용접선(1mm)`, async ({ page }) => {
      const weld = weldFixtureOf(site)!;
      const proposal = weld.lines.find((l) => l.topic.endsWith('/task/proposal'))!;
      const [, , cellId] = proposal.topic.split('/');
      const cell = config.cells.find((c) => c.id === cellId)!;
      const { path, surface } = proposal.payload as { path: [number, number][]; surface?: string };
      const lab = await openLab(page, `site=${site}&fixture=${weld.name}&t=${proposal.t}&freeze=1&hud=0`);
      await api(page, site).goto(proposal.t + 200);
      const seam = (await api(page, site).seam(cell.id))!;
      expect(seam, '제안 뒤에는 용접선이 있다').not.toBeNull();
      expect(seam.points).toHaveLength(path.length);
      // 판·면 위 1.5mm에 그리므로 3D로 2mm 이내
      seam.points.forEach((p, i) => {
        const e = pathPointToSite(config, cell, surface, path[i]);
        expect(Math.hypot(...p.map((v, k) => v - e[k])), `점 ${i}`).toBeLessThanOrEqual(2 * MM);
      });
      const robotTimes = weld.lines.filter((l) => l.topic === `innoworks/${site}/${cell.id}/robot/state`).map((l) => l.t);
      const end = robotTimes.at(-1)!;
      for (const t of [0.2, 0.45, 0.7].map((k) => Math.round(end * k) + 37)) {
        await api(page, site).goto(t);
        const expected = expectedJoints(weld.lines, site, cell.id, t - INTERP_DELAY_MS);
        const actual = (await api(page, site).joints(cell.id))!;
        for (const [n, v] of Object.entries(expected)) {
          expect(Math.abs(actual[n] - v), `t=${t} ${n}: ${actual[n]} vs ${v}`).toBeLessThanOrEqual(0.5);
        }
      }
      lab.expectClean();
    });

    test(`M4 ${site}: 프리셋마다 대상 셀이 화면 안에 들어온다(SC-03)`, async ({ page }) => {
      for (const preset of config.presets) {
        const lab = await openLab(page, `site=${site}&fixture=${fixturesOfSite(site)[0]}&freeze=1&preset=${preset.id}&hud=0`);
        const targets = config.cells.filter((c) => c.id === preset.id);
        for (const cell of targets.length ? targets : config.cells) {
          for (const part of (cell.plate ? ['plate', 'robot', 'lamp'] : ['robot', 'lamp']) as ('plate' | 'robot' | 'lamp')[]) {
            const p = await api(page, site).screen(cell.id, part);
            expect(p, `${preset.id}: ${cell.id} ${part}`).not.toBeNull();
            expect(p![0]).toBeGreaterThan(0);
            expect(p![0]).toBeLessThan(VIEW.w);
            expect(p![1]).toBeGreaterThan(0);
            expect(p![1]).toBeLessThan(VIEW.h);
          }
        }
        lab.expectClean();
      }
    });
  }

  test('IX-05: 사이트를 10번 오가도 GPU 메모리가 늘지 않고, 돌아오면 같은 화면이다', async ({ page }) => {
    const [a, b] = SITES;
    const lab = await openLab(page, `site=${a}&fixture=${fixturesOfSite(a)[0]}&t=1000&freeze=1&hud=0`);
    const before = await page.evaluate(() => window.__twin!.stats());
    for (let i = 0; i < 10; i++) {
      const to = i % 2 === 0 ? b : a;
      await page.evaluate((s) => window.__twin!.setSite(s), to);
      expect(await page.evaluate(() => window.__twin!.state().site)).toBe(to);
      // 바뀐 사이트의 셀이 보이고, 앞 사이트의 객체는 남지 않는다
      const cfg = siteConfig(to);
      const other = to === a ? b : a;
      expect((await api(page, to).object(cfg.cells[0].id, 'robot')).exists, `${to} 로봇`).toBe(true);
      expect(await page.evaluate((s) => window.__twin!.count(`background:${s}`), other), `${other} 배경이 남지 않는다`).toBe(0);
    }
    const after = await page.evaluate(() => window.__twin!.stats());
    expect(after.geometries).toBeLessThanOrEqual(before.geometries);
    expect(after.textures).toBeLessThanOrEqual(before.textures);
    const cam = await page.evaluate(() => window.__twin!.camera());
    const eye = siteConfig(a).presets[0].eye_m;
    expect(Math.hypot(...cam.position.map((v, k) => v - eye[k])), '첫 프리셋 위치로 돌아온다').toBeLessThan(0.01);
    lab.expectClean();
  });
});
