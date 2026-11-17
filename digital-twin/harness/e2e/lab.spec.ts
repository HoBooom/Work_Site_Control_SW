// L3 씬 상태: 픽스처를 특정 시각에 멈추고 window.__twin으로 상태를 확인한다.
import { expect, test } from '@playwright/test';
import { openLab } from './helpers';

const HOME = { joint_1: 0, joint_2: -30, joint_3: 30, joint_4: 0, joint_5: 45, joint_6: 0 };

test.describe('트윈 랩 @L3', () => {
  test('idle 픽스처를 멈춘 시각의 상태가 픽스처와 같다', async ({ page }) => {
    const lab = await openLab(page, 'site=shipyard&fixture=idle&t=1000&freeze=1');
    const s = await page.evaluate(() => window.__twin!.state());
    expect(s).toMatchObject({ site: 'shipyard', fixture: 'idle', t: 1000, frozen: true });
    expect(Object.keys(s.cells).sort()).toEqual(['shipyard/weld-cell-1', 'shipyard/weld-cell-2']);
    for (const c of Object.values(s.cells)) {
      expect(c.online).toBe(true);
      expect(c.task?.state).toBe('idle');
      expect(c.joints).toEqual(HOME);
      expect(c.jointsTs).toBe(1_767_225_600_000 + 1000);
    }
    lab.expectClean();
  });

  test('멈춰 있으면 시간이 지나도 상태가 그대로다', async ({ page }) => {
    const lab = await openLab(page, 'fixture=idle&t=500&freeze=1');
    const before = await page.evaluate(() => window.__twin!.state());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__twin!.state());
    expect(after).toEqual(before);
    lab.expectClean();
  });

  test('시계를 앞뒤로 옮겨도 같은 시각은 같은 상태다', async ({ page }) => {
    const lab = await openLab(page, 'fixture=idle&t=2000&freeze=1');
    const at2000 = await page.evaluate(() => window.__twin!.state());
    const back = await page.evaluate(() => {
      window.__twin!.setClock(300);
      const s300 = window.__twin!.state();
      window.__twin!.setClock(2000);
      return { s300, s2000: window.__twin!.state() };
    });
    expect(back.s300.t).toBe(300);
    expect(back.s300.cells['shipyard/weld-cell-1'].jointsTs).toBe(1_767_225_600_000 + 300);
    expect(back.s2000).toEqual(at2000);
    lab.expectClean();
  });

  test('멈추지 않으면 가상 시계가 흐른다', async ({ page }) => {
    const lab = await openLab(page, 'fixture=idle&t=0');
    const t0 = await page.evaluate(() => window.__twin!.state().t);
    await page.waitForTimeout(500);
    const t1 = await page.evaluate(() => window.__twin!.state().t);
    expect(t1 - t0).toBeGreaterThan(300);
    lab.expectClean();
  });

  test('렌더 통계를 낸다', async ({ page }) => {
    const lab = await openLab(page, 'fixture=idle&freeze=1');
    const st = await page.evaluate(() => window.__twin!.stats());
    expect(st.frames).toBeGreaterThanOrEqual(3);
    expect(st.calls).toBeGreaterThan(0);
    expect(st.triangles).toBeGreaterThan(0);
    lab.expectClean();
  });

  test('잘못된 인자는 화면과 콘솔에 오류를 내고 ready가 거부된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/lab?site=nowhere');
    await page.waitForFunction(() => !!window.__twin);
    const rejected = await page.evaluate(() => window.__twin!.ready().then(() => null, (e: Error) => e.message));
    expect(rejected).toContain('site-config 없음: nowhere');
    await expect(page.getByText('트윈 랩 오류')).toBeVisible();
    expect(errors.some((e) => e.includes('site-config 없음'))).toBe(true);
  });
});
