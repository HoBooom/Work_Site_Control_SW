// L3 M3-a: 렌더 설정(RD-02 환경광·톤매핑, RD-03 그림자, RD-04 SSAO, RD-05 품질 등급).
import { expect, test } from '@playwright/test';
import { QUALITY } from '../../../frontend/src/scene/quality';
import { siteConfig } from './data';
import { openLab } from './helpers';

const SITE = 'ship-block';
const config = siteConfig(SITE);
const PCF = 1; // THREE.PCFShadowMap

test.describe('렌더 설정 @L3', () => {
  for (const tier of ['high', 'low'] as const) {
    test(`RD-02~04: ${tier} 등급 설정이 spec 표와 같다`, async ({ page }) => {
      const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=4000&freeze=1&quality=${tier}`);
      const r = await page.evaluate(() => window.__twin!.render());
      const q = QUALITY[tier];
      expect(r.quality).toBe(tier);
      expect(r.environment, 'RD-02 환경광').toBe(true);
      expect(r.effects).toContain('tonemapping-neutral');
      expect(r.shadows).toEqual({ enabled: true, type: PCF, mapSize: q.shadowMapSize, radius: q.shadowRadius, keyLightCasts: true });
      expect(r.effects.includes('n8ao'), 'RD-04 SSAO는 high만').toBe(q.ssao);
      expect(r.effects.includes('bloom'), 'RD-06 아크 bloom은 high만').toBe(q.bloom);
      expect(r.robotsCastShadow, 'RD-03 로봇이 그림자를 드리운다').toBe(true);
      expect(r.backgroundReceivesShadow, 'RD-03 배경이 그림자를 받는다').toBe(true);
      lab.expectClean();
    });
  }

  test('RD-03: 키 라이트 그림자 범위가 모든 셀의 로봇·작업판을 덮는다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-basic&t=4000&freeze=1&quality=high`);
    const r = await page.evaluate(() => window.__twin!.render());
    const box = r.shadowBox!;
    for (const cell of config.cells) {
      // 이동 로봇 셀은 작업판이 없다(ADR 0003)
      for (const part of (cell.plate ? ['robot', 'plate'] : ['robot']) as ('robot' | 'plate')[]) {
        const o = await page.evaluate(([s, c, p]) => window.__twin!.object(s, c, p as 'robot'), [SITE, cell.id, part] as const);
        const [x, y, z] = o.position!;
        const [sx, sy, sz] = o.size!;
        // 객체 AABB의 모서리가 그림자 범위 안(그림자 카메라는 기울어 있어 AABB로 보수적으로 본다)
        for (const [px, py, pz] of [[x - sx, y - sy, z], [x + sx, y + sy, z + sz]]) {
          expect(px, `${cell.id} ${part} x`).toBeGreaterThan(box.min[0]);
          expect(px).toBeLessThan(box.max[0]);
          expect(py, `${cell.id} ${part} y`).toBeGreaterThan(box.min[1]);
          expect(py).toBeLessThan(box.max[1]);
          expect(pz, `${cell.id} ${part} z`).toBeGreaterThan(box.min[2]);
          expect(pz).toBeLessThan(box.max[2]);
        }
      }
    }
    lab.expectClean();
  });

  test('RD-05: 품질 인자가 없으면 기기에 따라 고른다(노트북 high)', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-idle&freeze=1`);
    expect((await page.evaluate(() => window.__twin!.render())).quality).toBe('high');
    lab.expectClean();
  });

  test('RD-05: 품질 인자가 없으면 기기에 따라 고른다(태블릿 low)', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      screen: { width: 1180, height: 820 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const lab = await openLab(page, `site=${SITE}&fixture=ship-block-idle&freeze=1`);
    expect((await page.evaluate(() => window.__twin!.render())).quality).toBe('low');
    lab.expectClean();
    await ctx.close();
  });
});
