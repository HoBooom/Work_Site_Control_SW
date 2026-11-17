import { useTwinStore, type CellState } from '../store/twin-store';
import type { VirtualClock } from './clock';
import type { FixturePlayer } from './fixture';
import type { StatsCollector, StatsSnapshot } from './stats';

/** window.__twin. 테스트는 화면 픽셀이 아니라 이 API로 상태를 확인한다(harness.md "디버그 API"). */
export interface TwinDebugApi {
  /** 에셋 로딩과 첫 프레임들이 끝나면 풀린다. 로딩 실패면 거부된다. */
  ready(): Promise<void>;
  state(): TwinLabState;
  stats(): StatsSnapshot;
  resetStats(): void;
  /** 시나리오 시각을 옮기고 즉시 반영한다 */
  setClock(t: number): void;
}

export interface TwinLabState {
  site: string | null;
  fixture: string | null;
  t: number;
  frozen: boolean;
  cells: Record<string, CellState>;
}

interface Bound {
  site: string;
  fixture: string;
  clock: VirtualClock;
  player: FixturePlayer;
  stats: StatsCollector;
}

declare global {
  interface Window {
    __twin?: TwinDebugApi;
  }
}

let bound: Bound | null = null;
let resolveReady!: () => void;
let rejectReady!: (e: unknown) => void;
const readyPromise = new Promise<void>((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});
readyPromise.catch(() => {}); // 아무도 기다리지 않을 때 unhandledrejection을 내지 않는다

function need(): Bound {
  if (!bound) throw new Error('트윈 랩이 아직 로딩되지 않았다. ready()를 먼저 기다린다.');
  return bound;
}

export function bindDebugApi(b: Bound) {
  bound = b;
}

export const markReady = () => resolveReady();
export const markFailed = (e: unknown) => rejectReady(e);

export function installDebugApi() {
  window.__twin = {
    ready: () => readyPromise,
    state: () => ({
      site: bound?.site ?? null,
      fixture: bound?.fixture ?? null,
      t: bound?.clock.t ?? 0,
      frozen: bound?.clock.frozen ?? false,
      cells: structuredClone(useTwinStore.getState().cells),
    }),
    stats: () => need().stats.snapshot(),
    resetStats: () => need().stats.reset(),
    setClock: (t: number) => {
      const b = need();
      b.clock.set(t);
      b.player.seek(t);
    },
  };
}
