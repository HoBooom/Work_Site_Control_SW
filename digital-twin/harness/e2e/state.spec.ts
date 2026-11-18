// L3 M2: 작업 상태 표현, 알람, 진행률, 수렴 결과, 오프라인, 데이터 끊김.
import { expect, test, type Page } from '@playwright/test';
import { COLORS, SEVERITY_COLOR, STATE_STYLE, STALE_AFTER_MS, polylineLength } from '../../../frontend/src/scene/cell-view';
import { INTERP_DELAY_MS } from '../../../frontend/src/scene/joints';
import { plateToSite } from '../../../frontend/src/scene/plate';
import { expectedJoints, fixture, lastPayload, siteConfig } from './data';
import { openLab } from './helpers';

const SITE = 'shipyard';
const config = siteConfig(SITE);
const [C1, C2] = config.cells;
const MM = 0.001;

const view = (page: Page, cell = C1.id) => page.evaluate(([s, c]) => window.__twin!.view(s, c), [SITE, cell] as const);
const seam = (page: Page, cell = C1.id) => page.evaluate(([s, c]) => window.__twin!.seam(s, c), [SITE, cell] as const);
const goto = (page: Page, t: number) =>
  page.evaluate(async (tt) => {
    window.__twin!.setClock(tt);
    await window.__twin!.frames(3);
  }, t);
const ratio = (part: number[][], whole: number[][]) => polylineLength(part as never) / polylineLength(whole as never);

test.describe('작업 상태 표현 @L3', () => {
  test('DY-04: 상태마다 정해진 램프색·라벨·선 모양이 나온다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=weld-basic&t=0&freeze=1`);
    const cases: [number, keyof typeof STATE_STYLE, 'none' | 'solid' | 'progress' | 'done'][] = [
      [200, 'idle', 'none'],
      [1000, 'proposed', 'solid'],
      [4000, 'running', 'progress'],
      [9000, 'completed', 'done'],
    ];
    for (const [t, state, mode] of cases) {
      await goto(page, t);
      const v = await view(page);
      expect(v.lamp, `t=${t}`).toEqual({ state, color: STATE_STYLE[state].lamp });
      expect(v.label?.state).toBe(state);
      expect(v.label?.text).toContain(C1.name);
      expect(v.label?.text).toContain(STATE_STYLE[state].label);
      const sm = await seam(page);
      if (mode === 'none') {
        expect(sm, `t=${t} 선 없음`).toBeNull();
        continue;
      }
      expect(sm!.dashed).toBe(false);
      if (mode === 'solid') {
        expect(sm!.done).toEqual([]);
        expect(sm!.todoColor).toBe(COLORS.seamTodo);
      }
      if (mode === 'done') {
        expect(sm!.todo).toEqual([]);
        expect(sm!.doneColor).toBe(COLORS.seamDone);
      }
    }
    expect((await view(page, C2.id)).lamp?.state, '셀 2는 계속 대기').toBe('idle');
    lab.expectClean();
  });

  test('DY-04: 수정 중은 점선, 긴급정지는 빨간 램프에 진행 모양 유지', async ({ page }) => {
    let lab = await openLab(page, `site=${SITE}&fixture=weld-edit&t=2000&freeze=1`);
    expect((await view(page)).lamp?.state).toBe('editing');
    expect((await seam(page))!.dashed).toBe(true);
    lab.expectClean();

    lab = await openLab(page, `site=${SITE}&fixture=alarm&t=4000&freeze=1`);
    const v = await view(page);
    expect(v.lamp).toEqual({ state: 'estopped', color: STATE_STYLE.estopped.lamp });
    const sm = (await seam(page))!;
    const progress = (lastPayload(fixture('alarm'), `innoworks/${SITE}/${C1.id}/task/progress`, 4000) as { progress: number }).progress;
    expect(Math.abs(ratio(sm.done, sm.points) - progress)).toBeLessThanOrEqual(0.01);
    lab.expectClean();
  });

  test('DY-06: 진행률만큼 선 길이가 완료색이다(오차 1%)', async ({ page }) => {
    const weld = fixture('weld-basic');
    const lab = await openLab(page, `site=${SITE}&fixture=weld-basic&t=2000&freeze=1`);
    for (const t of [2000, 3600, 5000, 7900]) {
      await goto(page, t);
      const p = (lastPayload(weld, `innoworks/${SITE}/${C1.id}/task/progress`, t) as { progress: number }).progress;
      const sm = (await seam(page))!;
      const r = sm.done.length ? ratio(sm.done, sm.points) : 0;
      expect(Math.abs(r - p), `t=${t} 진행률 ${p} vs 완료 길이 ${r}`).toBeLessThanOrEqual(0.01);
      expect(sm.doneColor).toBe(COLORS.seamDone);
    }
    lab.expectClean();
  });

  test('DY-05: 알람 수와 마커 수가 같고, 해제되면 사라진다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=alarm&t=0&freeze=1`);
    const cases: [number, string[]][] = [
      [2900, []],
      [3200, ['a-1']],
      [4000, ['a-2', 'a-1']], // 치명이 아래(먼저)
      [5200, ['a-1']],
      [6000, []],
    ];
    for (const [t, ids] of cases) {
      await goto(page, t);
      const v = await view(page);
      expect(v.alarms.map((a) => a.id), `t=${t}`).toEqual(ids);
      for (const a of v.alarms) expect(a.color).toBe(SEVERITY_COLOR[a.severity as keyof typeof SEVERITY_COLOR]);
    }
    expect((await view(page, C2.id)).alarms).toEqual([]);
    lab.expectClean();
  });

  test('DY-07: 수렴 결과가 오면 선이 새 경로로 바뀌고 이전 선이 남지 않는다', async ({ page }) => {
    const edit = fixture('weld-edit');
    const snap = edit.find((l) => l.topic.endsWith(`${C1.id}/task/snap`))!.payload as { path: [number, number][] };
    const proposal = edit.find((l) => l.topic.endsWith(`${C1.id}/task/proposal`))!.payload as { path: [number, number][] };
    const lab = await openLab(page, `site=${SITE}&fixture=weld-edit&t=2000&freeze=1`);
    const before = (await seam(page))!.points;
    before.forEach((p, i) => expect(Math.abs(p[1] - plateToSite(C1, proposal.path[i])[1])).toBeLessThanOrEqual(MM));
    for (const t of [3000, 4000]) {
      await goto(page, t);
      const after = (await seam(page))!.points;
      expect(after).toHaveLength(snap.path.length);
      after.forEach((p, i) => {
        const e = plateToSite(C1, snap.path[i]);
        expect(Math.hypot(p[0] - e[0], p[1] - e[1]), `t=${t} 점 ${i}`).toBeLessThanOrEqual(MM);
      });
      // 용접선 그룹은 하나, 그 안의 선은 상태(제안: 남은 구간 하나)만큼만
      expect(await page.evaluate((n) => window.__twin!.count(n), `seam:${SITE}/${C1.id}`)).toBe(1);
      expect(await page.evaluate((n) => window.__twin!.count(n, 'Line2'), `seam:${SITE}/${C1.id}`)).toBe(1);
    }
    lab.expectClean();
  });

  test('DY-08: 오프라인이면 셀이 회색이 되고, 다시 붙으면 retained 상태로 복구된다', async ({ page }) => {
    const lab = await openLab(page, `site=${SITE}&fixture=offline&t=3000&freeze=1`);
    let v = await view(page);
    expect(v.lamp?.state).toBe('running');
    expect(v.robotGray).toBe(false);
    await goto(page, 5000);
    v = await view(page);
    expect(v.lamp).toEqual({ state: 'offline', color: STATE_STYLE.offline.lamp });
    expect(v.label?.text).toContain('오프라인');
    expect(v.robotGray).toBe(true);
    const sm = (await seam(page))!;
    expect([sm.doneColor, sm.todoColor]).toEqual([COLORS.dim, COLORS.dim]);
    expect((await view(page, C2.id)).robotGray, '셀 2는 그대로').toBe(false);
    await goto(page, 7000);
    v = await view(page);
    expect(v.lamp?.state).toBe('paused');
    expect(v.robotGray).toBe(false);
    expect((await seam(page))!.todoColor).toBe(COLORS.seamTodo);
    lab.expectClean();
  });

  test('DY-09: robot/state가 1초 넘게 없으면 마지막 자세로 멈춤 표시, 다시 오면 사라진다', async ({ page }) => {
    const st = fixture('stale');
    const lab = await openLab(page, `site=${SITE}&fixture=stale&t=2500&freeze=1`);
    expect((await view(page)).stale).toBe(false);
    await goto(page, 3000 + STALE_AFTER_MS - 50);
    expect((await view(page)).stale, '1초 이내는 아직').toBe(false);
    await goto(page, 4500);
    expect((await view(page)).stale).toBe(true);
    const joints = (await page.evaluate(([s, c]) => window.__twin!.joints(s, c), [SITE, C1.id] as const))!;
    const last = expectedJoints(st, SITE, C1.id, 3000);
    for (const [n, val] of Object.entries(last)) expect(Math.abs(joints[n] - val), `마지막 자세 ${n}`).toBeLessThanOrEqual(0.5);
    expect((await view(page, C2.id)).stale, '셀 2는 계속 받는다').toBe(false);
    await goto(page, 6000 + INTERP_DELAY_MS + 200);
    expect((await view(page)).stale).toBe(false);
    lab.expectClean();
  });
});
