/**
 * 셀 상태 → 화면 표현 규칙(spec DY-04, DY-06, DY-08, DY-09). 순수 함수만 둔다(L2에서 검사).
 */
import type { CellState, JointSample } from '../store/twin-store';
import type { V3 } from './frame';

export type CellVisualState =
  | 'unknown'
  | 'idle'
  | 'proposed'
  | 'editing'
  | 'running'
  | 'completed'
  | 'paused'
  | 'estopped'
  | 'offline';

export const COLORS = {
  seamTodo: '#e5322d',
  seamDone: '#2ea043',
  dim: '#8b949e',
} as const;

/** 셀 상태색과 라벨. 정지는 깜빡이지 않는다 */
export const STATE_STYLE: Record<CellVisualState, { lamp: string; label: string }> = {
  unknown: { lamp: '#8b949e', label: '상태 없음' },
  idle: { lamp: '#8b949e', label: '대기' },
  proposed: { lamp: '#f0883e', label: '승인 대기' },
  editing: { lamp: '#f0883e', label: '수정 중' },
  running: { lamp: '#1f6feb', label: '실행 중' },
  completed: { lamp: '#2ea043', label: '확인 대기' },
  paused: { lamp: '#da3633', label: '일시정지' },
  estopped: { lamp: '#da3633', label: '긴급정지' },
  offline: { lamp: '#6e7681', label: '오프라인' },
};

export const SEVERITY_COLOR = { info: '#2f81f7', warning: '#d29922', critical: '#f85149' } as const;
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** robot/state가 이보다 오래 없으면 "멈춤" 표시(DY-09) */
export const STALE_AFTER_MS = 1000;

export function cellVisualState(c: CellState | undefined): CellVisualState {
  if (!c) return 'unknown';
  if (c.online === false) return 'offline';
  return c.task?.state ?? 'unknown';
}

export type SeamMode = 'none' | 'solid' | 'dashed' | 'progress' | 'done';

/** 작업 상태별 용접선 모양. 정지는 실행 중 모양을 그대로 둔다 */
export function seamMode(c: CellState | undefined): SeamMode {
  switch (c?.task?.state) {
    case 'proposed':
      return 'solid';
    case 'editing':
      return 'dashed';
    case 'running':
    case 'paused':
    case 'estopped':
      return 'progress';
    case 'completed':
      return 'done';
    default:
      return 'none';
  }
}

export interface SeamView {
  mode: SeamMode;
  /** 완료 구간(판 좌표 m) */
  done: V3[];
  /** 남은 구간(판 좌표 m) */
  todo: V3[];
  dashed: boolean;
  doneColor: string;
  todoColor: string;
}

/** 전체 경로와 상태로 그릴 두 구간을 정한다. 오프라인이면 같은 모양을 회색으로. */
export function seamView(c: CellState | undefined, points: V3[] | null): SeamView | null {
  const mode = seamMode(c);
  if (!points || points.length < 2 || mode === 'none') return null;
  const fraction = mode === 'done' ? 1 : mode === 'progress' ? (c?.progress?.progress ?? 0) : 0;
  const { done, todo } = splitPolyline(points, fraction);
  const dim = c?.online === false;
  return {
    mode,
    done,
    todo,
    dashed: mode === 'dashed',
    doneColor: dim ? COLORS.dim : COLORS.seamDone,
    todoColor: dim ? COLORS.dim : COLORS.seamTodo,
  };
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function polylineLength(points: readonly V3[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist(points[i - 1], points[i]);
  return s;
}

/** 길이 기준으로 fraction(0~1)만큼을 앞 구간으로 나눈다. 나누는 점은 두 구간에 모두 들어간다. */
export function splitPolyline(points: readonly V3[], fraction: number): { done: V3[]; todo: V3[] } {
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return { done: [], todo: [...points] };
  if (f >= 1) return { done: [...points], todo: [] };
  const target = polylineLength(points) * f;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (acc + seg >= target) {
      const k = seg > 0 ? (target - acc) / seg : 0;
      const a = points[i - 1];
      const b = points[i];
      const cut: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      return { done: [...points.slice(0, i), cut], todo: [cut, ...points.slice(i)] };
    }
    acc += seg;
  }
  return { done: [...points], todo: [] };
}

export function isStale(samples: readonly JointSample[] | undefined, now: number): boolean {
  if (!samples?.length) return false;
  return now - samples[samples.length - 1].at > STALE_AFTER_MS;
}

/** 알람 마커 순서: 심각도 높은 것부터, 같으면 먼저 난 것부터 */
export function sortedAlarms(c: CellState | undefined) {
  return Object.values(c?.alarms ?? {}).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ts - b.ts,
  );
}
