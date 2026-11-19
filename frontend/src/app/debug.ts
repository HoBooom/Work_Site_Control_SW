import type { BusStats } from '../bus/mqtt-bus';
import type { Selection } from '../scene/selection';
import type { CellState } from '../store/twin-store';

/** window.__app: 관제 화면 검사용(frontend/docs/spec.md 7절). 화면 픽셀이 아니라 이 값으로 단언한다 */
export interface AppDebugApi {
  site(): string;
  operator(): string;
  bus(): BusStats | null;
  selection(): Selection | null;
  cells(): Record<string, CellState>;
  /** 패널 영상 위에 그린 경로(화면 px, 영상 상자 기준)와 배치. 없으면 null */
  overlay(cell: string): { points: [number, number][]; fit: { x: number; y: number; scale: number }; box: [number, number]; frameSize: [number, number]; src: string } | null;
  /** 마지막으로 보낸 명령(cmd_id, 토픽 접미사, 대상 셀) */
  sent(): { cmd_id: string; suffix: string; cell: string | null }[];
}

declare global {
  interface Window {
    __app?: AppDebugApi;
  }
}
