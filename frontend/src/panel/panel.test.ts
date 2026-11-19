import { describe, expect, it } from 'vitest';
import { STATE_STYLE, type CellVisualState } from '../scene/cell-view';
import { controlsFor } from './controls';
import { boxToFrame, fitContain, frameToBox, splitAt, strokeToFrame } from './overlay';

describe('UI-03 영상 좌표', () => {
  it('비율 유지로 넣고 원본 픽셀 ↔ 화면이 1px 안에서 왕복한다', () => {
    const f = fitContain(1280, 720, 400, 300); // 위아래 빈 띠
    expect(f.scale).toBeCloseTo(400 / 1280);
    expect(f.x).toBe(0);
    expect(f.y).toBeCloseTo((300 - 225) / 2);
    for (const p of [[0, 0], [1280, 720], [640, 360], [123.4, 567.8]]) {
      const back = boxToFrame(f, frameToBox(f, p));
      expect(Math.hypot(back[0] - p[0], back[1] - p[1])).toBeLessThan(1e-9);
    }
    expect(frameToBox(f, [1280, 360])).toEqual([400, 150]);
  });
  it('진행률만큼 길이로 나눈다', () => {
    const { done, todo } = splitAt([[0, 0], [10, 0], [10, 10]], 0.25);
    expect(done).toEqual([[0, 0], [5, 0]]);
    expect(todo[0]).toEqual([5, 0]);
    expect(splitAt([[0, 0], [1, 0]], 1).todo).toEqual([]);
  });
});

describe('UI-04 버튼 활성화 표', () => {
  const ids = (s: CellVisualState, pending = false, connected = true) =>
    controlsFor(s, pending, connected)
      .filter((c) => c.enabled)
      .map((c) => c.id);
  it('상태별로 정해진 버튼만 눌린다', () => {
    expect(ids('idle')).toEqual(['estop']);
    expect(ids('proposed')).toEqual(['edit', 'approve', 'estop']);
    expect(ids('editing')).toEqual(['estop']);
    expect(ids('running')).toEqual(['estop']);
    expect(ids('completed')).toEqual(['confirm-rework', 'confirm-ok', 'estop']);
    expect(ids('paused')).toEqual(['resume', 'estop']);
    expect(ids('estopped')).toEqual(['resume']);
    expect(ids('offline')).toEqual([]);
  });
  it('응답을 기다리는 동안에는 정지 말고 모두 막고, 끊기면 모두 막는다', () => {
    expect(ids('proposed', true)).toEqual(['estop']);
    expect(ids('completed', true)).toEqual(['estop']);
    expect(ids('proposed', false, false)).toEqual([]);
  });
  it('모든 상태가 표에 있다', () => {
    for (const s of Object.keys(STATE_STYLE) as CellVisualState[]) expect(() => controlsFor(s, false, true)).not.toThrow();
  });
});

describe('UI-05 그린 선 → 원본 픽셀', () => {
  it('화면 좌표를 원본 픽셀로 바꾸고, 프레임 밖은 가장자리로, 가까운 점은 버린다(끝점은 남김)', () => {
    const f = fitContain(1280, 720, 640, 360); // 0.5배
    const stroke = [[10, 100], [10.5, 100.5], [11, 101], [100, 100], [700, 100]];
    const out = strokeToFrame(f, 1280, 720, stroke);
    expect(out[0]).toEqual([20, 200]);
    expect(out[out.length - 1]).toEqual([1280, 200]); // 밖으로 나간 끝은 가장자리
    expect(out).toContainEqual([200, 200]);
    expect(out.length).toBe(3);
  });
});
