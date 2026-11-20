import { create } from 'zustand';
import { parseCellTopic } from '../bus/topics';
import type {
  Alarm,
  CellTopicPayloads,
  FootContacts,
  RobotBase,
  TaskProgress,
  TaskProposal,
  TaskSnap,
  TaskState,
  VisionMetrics,
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
  /** 최근 robot/state 샘플(오래된 것부터). 씬이 보간에 쓴다(DY-01). at = 수신 시각 */
  jointSamples: JointSample[];
  /** 이동 로봇의 마지막 몸통 자세(ADR 0003). 고정 로봇은 null. 보간은 jointSamples[].base로 한다 */
  base: RobotBase | null;
  /** 마지막 발 접촉(발 링크 이름 → 붙음). 고정 로봇은 null */
  contacts: FootContacts | null;
  task: TaskState | null;
  proposal: TaskProposal | null;
  snap: TaskSnap | null;
  progress: TaskProgress | null;
  /** 활성 알람만. alarm_id → 알람 */
  alarms: Record<string, Alarm>;
  /** 마지막 비전 메트릭(UI-09) */
  metrics: VisionMetrics | null;
}

export interface JointSample {
  /** 수신 시각(ms). 시간 기준은 apply를 부르는 쪽이 정한다: 랩은 가상 시계, 앱은 performance.now() */
  at: number;
  ts: number;
  joints: Record<string, number>;
  /** 이동 로봇만 */
  base?: RobotBase;
  contacts?: FootContacts;
}

/** 보간에 쓰는 샘플 수. 20Hz에서 400ms 분량 */
export const JOINT_SAMPLES_KEPT = 8;

export const cellKey = (site: string, cell: string) => `${site}/${cell}`;

function emptyCell(site: string, cell: string): CellState {
  return {
    site,
    cell,
    online: null,
    joints: null,
    jointsTs: null,
    jointSamples: [],
    base: null,
    contacts: null,
    task: null,
    proposal: null,
    snap: null,
    progress: null,
    alarms: {},
    metrics: null,
  };
}

/** 메시지 하나를 셀 상태에 반영한 새 상태를 돌려준다(순수 함수). */
export function reduceCell<S extends keyof CellTopicPayloads>(
  prev: CellState,
  suffix: S,
  payload: CellTopicPayloads[S],
  at: number,
): CellState {
  switch (suffix) {
    case 'robot/state': {
      const p = payload as CellTopicPayloads['robot/state'];
      const sample: JointSample = { at, ts: p.ts, joints: p.joints };
      if (p.base) sample.base = p.base;
      if (p.contacts) sample.contacts = p.contacts;
      return {
        ...prev,
        joints: p.joints,
        jointsTs: p.ts,
        base: p.base ?? null,
        contacts: p.contacts ?? null,
        jointSamples: [...prev.jointSamples, sample].slice(-JOINT_SAMPLES_KEPT),
      };
    }
    case 'task/state': {
      const p = payload as CellTopicPayloads['task/state'];
      // 이미 받은 것보다 오래된 상태는 버린다: 구독 직후 브로커가 예전 retained 값을 새 값 뒤에 보내는 경합이 있다
      if (prev.task && p.ts < prev.task.ts) return prev;
      // 작업이 바뀌면 이전 작업의 경로·진행률을 버린다
      const changed = prev.task?.task_id !== p.task_id;
      return changed
        ? { ...prev, task: p, proposal: null, snap: null, progress: null }
        : { ...prev, task: p };
    }
    case 'task/proposal': {
      const p = payload as TaskProposal;
      if (prev.proposal && p.ts < prev.proposal.ts) return prev; // 위와 같은 경합
      return { ...prev, proposal: p, snap: null };
    }
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
    case 'vision/metrics':
      return { ...prev, metrics: payload as VisionMetrics };
    default:
      return prev;
  }
}

export interface TwinStore {
  cells: Record<string, CellState>;
  /**
   * 토픽 메시지 반영. 셀 토픽이 아니면 false. payload 검증은 들어오는 쪽(bus, L0 픽스처 검사)이 맡는다.
   * at: 수신 시각(ms). 씬의 시간 기준(TwinTimeContext)과 같은 시계여야 한다.
   */
  apply: (topic: string, payload: unknown, at: number) => boolean;
  reset: () => void;
}

export const useTwinStore = create<TwinStore>((set) => ({
  cells: {},
  apply: (topic, payload, at) => {
    const t = parseCellTopic(topic);
    if (!t) return false;
    const key = cellKey(t.site, t.cell);
    set((s) => ({
      cells: {
        ...s.cells,
        [key]: reduceCell(s.cells[key] ?? emptyCell(t.site, t.cell), t.suffix, payload as never, at),
      },
    }));
    return true;
  },
  reset: () => set({ cells: {} }),
}));
