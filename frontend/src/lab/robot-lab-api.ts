// 로봇 랩(/lab/robot)의 window.__robotLab 타입. 하네스(digital-twin/harness)도 이 파일을 읽는다(React 없이).
type V3 = [number, number, number];

export type Mount = 'floor' | 'wall';

export interface JointMeta {
  name: string;
  /** deg */
  lower: number;
  upper: number;
}

export interface RobotLabApi {
  ready(): Promise<void>;
  state(): { robot: string; mount: Mount; joints: Record<string, number>; meta: JointMeta[]; meshes: number; triangles: number };
  setJoints(deg: Record<string, number>): Promise<void>;
  setMount(mount: Mount): Promise<void>;
  /** 링크(없으면 로봇 전체)의 월드 AABB. own이면 자식 링크를 빼고 그 링크의 메시만 */
  box(link?: string, own?: boolean): { min: V3; max: V3 };
  /** 링크 원점과 Z축 방향 */
  frame(link: string): { origin: V3; z: V3 };
}

declare global {
  interface Window {
    __robotLab?: RobotLabApi;
  }
}
