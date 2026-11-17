// L5 성능: 픽스처를 재생하며 fps, 프레임 시간, 드로우 콜, 삼각형, 첫 ready 시간을 잰다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openLab } from './helpers';

const budget = JSON.parse(readFileSync(new URL('../budget.json', import.meta.url), 'utf8'));
const outDir = new URL('../out/', import.meta.url);
const results: Record<string, unknown>[] = [];

test.describe('성능 예산 @perf', () => {
  test.afterAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(new URL('stats.json', outDir), JSON.stringify(results, null, 2) + '\n');
  });

  for (const sc of budget.scenes as { site: string; fixture: string; preset: string; quality: 'high' | 'low' }[]) {
    test(`${sc.site}-${sc.fixture}-${sc.preset}-${sc.quality}`, async ({ page }) => {
      test.setTimeout(budget.measure_ms + 60_000);
      const start = Date.now();
      const lab = await openLab(page, `site=${sc.site}&fixture=${sc.fixture}&preset=${sc.preset}&quality=${sc.quality}&hud=0`);
      const readyMs = Date.now() - start;
      await page.evaluate(() => window.__twin!.resetStats());
      await page.waitForTimeout(budget.measure_ms);
      const st = await page.evaluate(() => window.__twin!.stats());
      const tier = budget.tiers[sc.quality];
      results.push({ ...sc, ready_ms: readyMs, ...st });

      expect.soft(st.fps_avg, 'fps 평균').toBeGreaterThanOrEqual(tier.fps_avg_min);
      expect.soft(st.frame_ms_p95, '프레임 p95(ms)').toBeLessThanOrEqual(tier.frame_ms_p95_max);
      expect.soft(st.calls, '드로우 콜').toBeLessThanOrEqual(budget.per_site.draw_calls_max);
      expect.soft(st.triangles, '삼각형').toBeLessThanOrEqual(budget.per_site.triangles_max);
      expect.soft(readyMs, '첫 ready(ms)').toBeLessThanOrEqual(budget.per_site.first_ready_ms_max);
      lab.expectClean();
    });
  }
});
