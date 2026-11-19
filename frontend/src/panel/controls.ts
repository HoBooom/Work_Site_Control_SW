import type { CellVisualState } from '../scene/cell-view';

export type ControlId = 'edit' | 'approve' | 'confirm-ok' | 'confirm-rework' | 'resume' | 'estop';

export interface Control {
  id: ControlId;
  label: string;
  enabled: boolean;
}

/**
 * UI-04: 서버 상태별 작업 버튼. 활성화는 서버 상태로만 정한다(frontend 핵심 규칙).
 * pending이면(명령을 보내고 서버 응답을 기다리는 중) 정지 말고 모두 막는다. 정지는 언제나 누를 수 있다.
 */
export function controlsFor(state: CellVisualState, pending: boolean, connected: boolean): Control[] {
  const can = (on: boolean) => on && !pending && connected;
  const out: Control[] = [];
  switch (state) {
    case 'proposed':
      out.push({ id: 'edit', label: '수정', enabled: can(true) }, { id: 'approve', label: '승인', enabled: can(true) });
      break;
    case 'completed':
      out.push({ id: 'confirm-ok', label: '합격', enabled: can(true) }, { id: 'confirm-rework', label: '재작업', enabled: can(true) });
      break;
    case 'estopped':
    case 'paused':
      out.push({ id: 'resume', label: '재개', enabled: can(true) });
      break;
    default:
      break;
  }
  if (state !== 'estopped' && state !== 'offline' && state !== 'unknown') out.push({ id: 'estop', label: '이 로봇 정지', enabled: connected });
  return out;
}

/** 상태별 안내 문구 */
export const HINT: Partial<Record<CellVisualState, string>> = {
  idle: 'AI 경로 제안을 기다리는 중',
  proposed: '제안 경로를 확인하고 승인하거나 수정한다',
  editing: '수정 중: 멈춘 영상 위에 경로를 다시 그린다',
  running: '용접 중',
  completed: '용접이 끝났다. 결과를 확인한다',
  paused: '일시정지됨. 확인 뒤 재개한다',
  estopped: '긴급정지됨. 안전을 확인한 뒤 재개한다',
  offline: '서버와 연결이 끊겼다',
};
