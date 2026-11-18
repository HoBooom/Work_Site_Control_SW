import { describe, expect, it } from 'vitest';
import type { CellState } from '../store/twin-store';
import type { V3 } from './frame';
import {
  COLORS,
  STALE_AFTER_MS,
  cellVisualState,
  isStale,
  polylineLength,
  seamMode,
  seamView,
  sortedAlarms,
  splitPolyline,
} from './cell-view';

const cell = (over: Partial<CellState> = {}): CellState => ({
  site: 's',
  cell: 'c',
  online: true,
  joints: null,
  jointsTs: null,
  jointSamples: [],
  task: null,
  proposal: null,
  snap: null,
  progress: null,
  alarms: {},
  ...over,
});
const task = (state: NonNullable<CellState['task']>['state']) => ({ v: 1 as const, ts: 0, state, task_id: 't' });
const line: V3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
];

describe('cellVisualState', () => {
  it('오프라인이 작업 상태보다 먼저다', () => {
    expect(cellVisualState(cell({ online: false, task: task('running') }))).toBe('offline');
    expect(cellVisualState(cell({ task: task('running') }))).toBe('running');
    expect(cellVisualState(cell())).toBe('unknown');
    expect(cellVisualState(undefined)).toBe('unknown');
  });
});

describe('seamMode (spec DY-04 표)', () => {
  it.each([
    ['proposed', 'solid'],
    ['editing', 'dashed'],
    ['running', 'progress'],
    ['paused', 'progress'],
    ['estopped', 'progress'],
    ['completed', 'done'],
    ['idle', 'none'],
  ] as const)('%s → %s', (state, mode) => {
    expect(seamMode(cell({ task: task(state) }))).toBe(mode);
  });
});

describe('splitPolyline', () => {
  it('길이 기준으로 나눈다', () => {
    const { done, todo } = splitPolyline(line, 0.25);
    expect(polylineLength(done)).toBeCloseTo(0.5);
    expect(polylineLength(todo)).toBeCloseTo(1.5);
    expect(done.at(-1)).toEqual(todo[0]);
  });

  it('꼭짓점을 넘어가는 지점도 나눈다', () => {
    const { done } = splitPolyline(line, 0.75);
    expect(done.at(-1)?.[0]).toBeCloseTo(1);
    expect(done.at(-1)?.[1]).toBeCloseTo(0.5);
  });

  it('0과 1은 한쪽이 비어 있다', () => {
    expect(splitPolyline(line, 0).done).toEqual([]);
    expect(splitPolyline(line, 1).todo).toEqual([]);
    expect(splitPolyline(line, 7).todo).toEqual([]);
  });
});

describe('seamView', () => {
  it('실행 중이면 진행률만큼 완료색', () => {
    const v = seamView(cell({ task: task('running'), progress: { v: 1, ts: 0, task_id: 't', progress: 0.4 } }), line)!;
    expect(polylineLength(v.done) / polylineLength(line)).toBeCloseTo(0.4);
    expect([v.doneColor, v.todoColor]).toEqual([COLORS.seamDone, COLORS.seamTodo]);
  });

  it('수정 중이면 점선', () => {
    expect(seamView(cell({ task: task('editing') }), line)?.dashed).toBe(true);
  });

  it('오프라인이면 같은 모양을 회색으로', () => {
    const v = seamView(cell({ online: false, task: task('running') }), line)!;
    expect([v.doneColor, v.todoColor]).toEqual([COLORS.dim, COLORS.dim]);
  });

  it('대기거나 점이 부족하면 그리지 않는다', () => {
    expect(seamView(cell({ task: task('idle') }), line)).toBeNull();
    expect(seamView(cell({ task: task('proposed') }), [[0, 0, 0]])).toBeNull();
  });
});

describe('isStale', () => {
  const samples = [{ at: 1000, ts: 0, joints: {} }];
  it(`${STALE_AFTER_MS}ms 넘게 샘플이 없으면 멈춤`, () => {
    expect(isStale(samples, 1000 + STALE_AFTER_MS)).toBe(false);
    expect(isStale(samples, 1001 + STALE_AFTER_MS)).toBe(true);
    expect(isStale([], 99999)).toBe(false);
  });
});

describe('sortedAlarms', () => {
  it('심각도, 발생 순', () => {
    const a = (id: string, severity: 'info' | 'warning' | 'critical', ts: number) => ({
      v: 1 as const, ts, alarm_id: id, severity, code: '', message: '', active: true,
    });
    const c = cell({ alarms: { x: a('x', 'info', 1), y: a('y', 'critical', 5), z: a('z', 'critical', 2), w: a('w', 'warning', 0) } });
    expect(sortedAlarms(c).map((x) => x.alarm_id)).toEqual(['z', 'y', 'w', 'x']);
  });
});
