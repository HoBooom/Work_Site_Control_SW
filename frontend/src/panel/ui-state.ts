import type { Alarm, SiteConfig } from '../contracts/messages.gen';
import { STATE_STYLE, type CellVisualState } from '../scene/cell-view';

/**
 * 2D 화면(패널·하단 독·알람 카드)의 상태 색. 디자인 v3(ADR 0006)은 흑백에 빨강 하나: 멈춤만 빨강이다.
 * 3D 트윈의 상태 색(scene/cell-view.ts)은 트윈 기준 화면과 묶여 있어 따로 둔다. 상태 이름은 같은 것을 쓴다.
 */
const DOT: Record<CellVisualState, string> = {
  unknown: '#5C5E62',
  idle: '#5C5E62',
  proposed: '#171A20',
  editing: '#171A20',
  running: '#393C41',
  completed: '#171A20',
  paused: '#C2261C',
  estopped: '#C2261C',
  offline: '#5C5E62',
};

export function uiState(state: CellVisualState): { dot: string; label: string } {
  return { dot: DOT[state], label: STATE_STYLE[state].label };
}

/** 진행률을 큰 숫자로 보이는 상태(그 밖에는 AI 신뢰도) */
export function showsProgress(state: CellVisualState): boolean {
  return state === 'running' || state === 'completed' || state === 'estopped' || state === 'paused';
}

export const SEVERITY_UI: Record<Alarm['severity'], { label: string; bg: string; fg: string }> = {
  critical: { label: '치명', bg: '#C2261C', fg: '#FFFFFF' },
  warning: { label: '경고', bg: '#171A20', fg: '#FFFFFF' },
  info: { label: '정보', bg: '#D0D1D2', fg: '#171A20' },
};

/** 작업 이름: 제안된 작업판(surface)의 이름. 제안이 없으면 '작업 없음' */
export function jobName(config: SiteConfig, surface: string | null | undefined): string {
  if (!surface) return '작업 없음';
  return config.surfaces?.find((x) => x.id === surface)?.name ?? surface;
}
