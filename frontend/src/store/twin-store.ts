import { create } from 'zustand';
import { parseCellTopic } from '../bus/topics';
import type {
  Alarm,
  CellTopicPayloads,
  TaskProgress,
  TaskProposal,
  TaskSnap,
  TaskState,
} from '../contracts/messages.gen';

/** 셀 하나의 "지금 상태". 서버가 보낸 메시지로만 바뀐다. */
export interface CellState {
  site: string;
  cell: string;
  /** null = 아직 status를 못 받음 */
  online: boolean | null;
  joints: Record<string, number> | null;
  /** 마지막 robot/state의 ts(epoch ms) */
  jointsTs: number | null;
  task: TaskState | null;
  proposal: TaskProposal | null;
  snap: TaskSnap | null;
  progress: TaskProgress | null;
  /** 활성 알람만. alarm_id → 알람 */
  alarms: Record<string, Alarm>;
}

export const cellKey = (site: string, cell: string) => `${site}/${cell}`;

function emptyCell(site: string, cell: string): CellState {
  return {
    site,
    cell,
    online: null,
    joints: null,
    jointsTs: null,
    task: null,
    proposal: null,
    snap: null,
    progress: null,
    alarms: {},
  };
}

/** 메시지 하나를 셀 상태에 반영한 새 상태를 돌려준다(순수 함수). */
export function reduceCell<S extends keyof CellTopicPayloads>(
  prev: CellState,
  suffix: S,
  payload: CellTopicPayloads[S],
): CellState {
  switch (suffix) {
    case 'robot/state': {
      const p = payload as CellTopicPayloads['robot/state'];
      return { ...prev, joints: p.joints, jointsTs: p.ts };
    }
    case 'task/state': {
      const p = payload as CellTopicPayloads['task/state'];
      // 작업이 바뀌면 이전 작업의 경로·진행률을 버린다
      const changed = prev.task?.task_id !== p.task_id;
      return changed
        ? { ...prev, task: p, proposal: null, snap: null, progress: null }
        : { ...prev, task: p };
    }
    case 'task/proposal':
      return { ...prev, proposal: payload as TaskProposal, snap: null };
    case 'task/snap':
      return { ...prev, snap: payload as TaskSnap };
    case 'task/progress':
      return { ...prev, progress: payload as TaskProgress };
    case 'alarm': {
      const p = payload as Alarm;
      const alarms = { ...prev.alarms };
      if (p.active) alarms[p.alarm_id] = p;
      else delete alarms[p.alarm_id];
      return { ...prev, alarms };
    }
    case 'status':
      return { ...prev, online: (payload as CellTopicPayloads['status']).state === 'online' };
    default:
      return prev;
  }
}

export interface TwinStore {
  cells: Record<string, CellState>;
  /** 토픽 메시지 반영. 셀 토픽이 아니면 false. payload 검증은 들어오는 쪽(bus, L0 픽스처 검사)이 맡는다. */
  apply: (topic: string, payload: unknown) => boolean;
  reset: () => void;
}

export const useTwinStore = create<TwinStore>((set) => ({
  cells: {},
  apply: (topic, payload) => {
    const t = parseCellTopic(topic);
    if (!t) return false;
    const key = cellKey(t.site, t.cell);
    set((s) => ({
      cells: {
        ...s.cells,
        [key]: reduceCell(s.cells[key] ?? emptyCell(t.site, t.cell), t.suffix, payload as never),
      },
    }));
    return true;
  },
  reset: () => set({ cells: {} }),
}));
