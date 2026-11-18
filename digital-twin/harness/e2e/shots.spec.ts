// L4 스크린샷: shots.json의 장면을 찍어 golden/과 비교한다. 허용 오차는 playwright.config.ts.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openLab, shotName, shotQuery, type Shot } from './helpers';

const { shots } = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8')) as {
  shots: Shot[];
};

test.describe('기준 장면 @L4', () => {
  for (const shot of shots) {
    test(shotName(shot), async ({ page }) => {
      const lab = await openLab(page, shotQuery(shot));
      if (shot.select) {
        const { cell, part } = shot.select;
        const p = await page.evaluate(([s, c, pt]) => window.__twin!.screen(s, c, pt as 'robot'), [shot.site, cell, part] as const);
        expect(p, `${cell} ${part}가 화면에 있어야 한다`).not.toBeNull();
        await page.mouse.click(p![0], p![1]);
        expect(await page.evaluate(() => window.__twin!.selection()), '선택되어야 한다').not.toBeNull();
        await page.mouse.move(0, 0); // 커서가 장면에 남지 않게
      }
      await expect(page).toHaveScreenshot(`${shotName(shot)}.png`);
      lab.expectClean();
    });
  }
});
