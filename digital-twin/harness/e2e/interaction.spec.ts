// L3 M2: 선택, 카메라 프리셋과 전환, 셀 라벨, 사이트·품질 전환.
import { expect, test, type Page } from '@playwright/test';
import { PRESET_TRANSITION_MS } from '../../../frontend/src/scene/camera-limits';
import { siteConfig } from './data';
import { openLab } from './helpers';

const SITE = 'ship-block';
const config = siteConfig(SITE);
const [C1, C2] = config.cells;
const VIEW = { w: 1280, h: 720 };

const screen = (page: Page, cell: string, part: 'robot' | 'plate' | 'lamp' | { alarm: string }) =>
  page.evaluate(([s, c, p]) => window.__twin!.screen(s, c, p as never), [SITE, cell, part] as const);
const selection = (page: Page) => page.evaluate(() => window.__twin!.selection());
const camera = (page: Page) => page.evaluate(() => window.__twin!.camera());

test.describe('상호작용 @L3', () => {
  test('IX-02: 로봇·알람 마커를 누르면 선택 이벤트가 정확하고, 빈 곳·드래그는 선택하지 않는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-alarm&t=4000&freeze=1&preset=spider-1&hud=0`);
    const robot = (await screen(page, C1.id, 'robot'))!;
    await page.mouse.click(robot[0], robot[1]);
    expect(await selection(page)).toEqual({ site: SITE, cell: C1.id, kind: 'robot', id: C1.id });

    const marker = (await screen(page, C1.id, { alarm: 'a-2' }))!;
    await page.mouse.click(marker[0], marker[1]);
    expect(await selection(page)).toEqual({ site: SITE, cell: C1.id, kind: 'alarm', id: 'a-2' });

    // 스파이더 2는 스파이더 1 클로즈업 밖에 있다. 프리셋을 옮겨(전환 800ms) 누른다
    await page.evaluate(() => window.__twin!.setPreset('spider-2'));
    await page.waitForTimeout(1000);
    const robot2 = (await screen(page, C2.id, 'robot'))!;
    await page.mouse.click(robot2[0], robot2[1]);
    expect(await selection(page)).toEqual({ site: SITE, cell: C2.id, kind: 'robot', id: C2.id });

    await page.mouse.click(40, VIEW.h - 40); // 배경(블록·바닥)
    expect(await selection(page), '빈 곳을 누르면 해제').toBeNull();

    // 로봇 위에서 시작한 드래그는 카메라 조작이다
    const r = (await screen(page, C2.id, 'robot'))!;
    await page.mouse.move(r[0], r[1]);
    await page.mouse.down();
    await page.mouse.move(r[0] + 40, r[1] + 10, { steps: 5 });
    await page.mouse.up();
    expect(await selection(page)).toBeNull();
    lab.expectClean();
  });

  test('IX-03: 프리셋 전환은 부드럽고, 이동 중에 바꿔도 튀지 않는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-idle&freeze=1&preset=overview&hud=0`);
    // 매 프레임 카메라 위치를 기록한다. 중간에 다른 프리셋으로 바꾼다
    const track = await page.evaluate(async (switchAfterMs) => {
      const tw = window.__twin!;
      const out: { t: number; pos: number[] }[] = [];
      const t0 = performance.now();
      tw.setPreset('spider-1');
      let switched = false;
      while (performance.now() - t0 < switchAfterMs * 4) {
        await tw.frames(1);
        const now = performance.now() - t0;
        out.push({ t: now, pos: tw.camera().position });
        if (!switched && now > switchAfterMs) {
          tw.setPreset('spider-2');
          switched = true;
        }
      }
      return out;
    }, PRESET_TRANSITION_MS / 2);
    const steps = track.slice(1).map((s, i) => Math.hypot(...s.pos.map((v, k) => v - track[i].pos[k])));
    // 튀지 않는다: 한 프레임 이동이 전환 거리의 15% 이하. 800ms 3차 이징의 최고 속도는 평균의 3배(60fps에서 ≈ 6%/프레임)이고,
    // 프레임이 한 번 늦으면 두 배가 된다. 순간이동(한 프레임에 대부분)은 걸린다. 사이트 크기와 상관없는 기준
    const eye = (id: string) => config.presets.find((p) => p.id === id)!.eye_m;
    const span = Math.max(Math.hypot(...eye('overview').map((v, k) => v - eye('spider-1')[k])), Math.hypot(...eye('spider-1').map((v, k) => v - eye('spider-2')[k])));
    expect(Math.max(...steps), `한 프레임에 전환 거리(${span.toFixed(1)}m)의 15% 넘게 움직이지 않는다`).toBeLessThan(0.15 * span);
    expect(track.filter((_, i) => steps[i - 1] > 0.001).length, '여러 프레임에 걸쳐 움직인다').toBeGreaterThan(10);
    const end = track[track.length - 1].pos;
    const target = config.presets.find((p) => p.id === 'spider-2')!.eye_m;
    expect(Math.hypot(...end.map((v, k) => v - target[k])), '마지막 프리셋에 도착한다').toBeLessThan(0.01);
    lab.expectClean();
  });

  test('IX-04: 셀 라벨이 이름과 상태를 보이고, 카메라를 돌려도 셀 위에 붙어 있다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=4000&freeze=1&hud=0`);
    const gap = async (cell: string) => {
      const lamp = (await screen(page, cell, 'lamp'))!;
      const box = (await page.getByTestId(`cell-label-${SITE}-${cell}`).boundingBox())!;
      // 라벨은 램프 바로 위
      return { dx: Math.abs(box.x + box.width / 2 - lamp[0]), dy: lamp[1] - (box.y + box.height / 2) };
    };
    for (const cell of config.cells) {
      await expect(page.getByTestId(`cell-label-${SITE}-${cell.id}`)).toContainText(cell.name);
    }
    for (let i = 0; i < 3; i++) {
      for (const cell of config.cells) {
        const g = await gap(cell.id);
        expect(g.dx, `${cell.id} 가로`).toBeLessThan(8);
        expect(g.dy, `${cell.id} 위`).toBeGreaterThan(0);
        expect(g.dy, `${cell.id} 위`).toBeLessThan(90);
      }
      await page.mouse.move(640, 360);
      await page.mouse.down();
      await page.mouse.move(900, 300, { steps: 6 });
      await page.mouse.up();
      await page.evaluate(() => window.__twin!.frames(2));
    }
    lab.expectClean();
  });

  test('IX-05: 사이트를 10번 다시 띄워도 GPU 메모리가 늘지 않는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=4000&freeze=1&hud=0`);
    const before = await page.evaluate(() => window.__twin!.stats());
    for (let i = 0; i < 10; i++) await page.evaluate((s) => window.__twin!.setSite(s), SITE);
    const after = await page.evaluate(() => window.__twin!.stats());
    expect(after.geometries).toBeLessThanOrEqual(before.geometries);
    expect(after.textures).toBeLessThanOrEqual(before.textures);
    // 다시 띄운 뒤에도 같은 상태가 보인다
    const v = await page.evaluate(([s, c]) => window.__twin!.view(s, c), [SITE, C1.id] as const);
    expect(v.lamp?.state).toBe('running');
    // 카메라는 첫 프리셋 위치
    const cam = await camera(page);
    const eye = config.presets[0].eye_m;
    expect(Math.hypot(...cam.position.map((v, k) => v - eye[k]))).toBeLessThan(0.01);
    lab.expectClean();
  });

  test('품질 전환: low ↔ high로 바꿔도 씬이 다시 뜬다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-idle&freeze=1&hud=0`);
    await page.evaluate(() => window.__twin!.setQuality('low'));
    expect((await page.evaluate(() => window.__twin!.stats())).frames).toBeGreaterThan(0);
    await page.evaluate(() => window.__twin!.setQuality('high'));
    expect(await page.evaluate(([s, c]) => window.__twin!.object(s, c, 'robot').exists, [SITE, C1.id] as const)).toBe(true);
    lab.expectClean();
  });
});
