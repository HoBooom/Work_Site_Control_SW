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
      await expect(page).toHaveScreenshot(`${shotName(shot)}.png`);
      lab.expectClean();
    });
  }
});
