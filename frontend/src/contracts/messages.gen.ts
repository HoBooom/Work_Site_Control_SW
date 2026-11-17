/* 생성 파일. 직접 고치지 않는다. contracts/schemas를 고친 뒤 `npm run gen:types`. */
/* eslint-disable */

/**
 * innoworks/{site}/{cell}/alarm. 서버→웹, QoS 1. 같은 alarm_id로 active=false가 오면 해제.
 */
export interface Alarm {
  v: 1;
  ts: number;
  alarm_id: string;
  severity: 'info' | 'warning' | 'critical';
  /**
   * 예: CMD_REJECTED, HEARTBEAT_LOST, SCENE_CHANGED
   */
  code: string;
  message: string;
  active: boolean;
}

/**
 * innoworks/{site}/{cell}/robot/state. 서버→웹, 10~20Hz, QoS 0. 관절 이름은 로봇 URDF의 joint 이름과 같다.
 */
export interface RobotState {
  /**
   * 스키마 버전
   */
  v: 1;
  /**
   * epoch ms
   */
  ts: number;
  /**
   * 관절 이름 → 각도(deg)
   */
  joints: {
    [k: string]: number;
  };
}

export type KebabId = string;
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vec3 = [number, number, number];

/**
 * digital-twin/site-config/{site}.json. 웹이 읽는 사이트 설정. 좌표는 사이트 좌표계(USD와 같음: Z-up, m, 회전 deg). 셀의 위치·회전은 USD에서 생성한다.
 */
export interface SiteConfig {
  v: 1;
  site: KebabId;
  name: string;
  background: {
    /**
     * 배경 GLB 경로(public 기준). 에셋이 없으면 null
     */
    glb: string | null;
  };
  environment?: {
    hdri?: string | null;
    exposure?: number;
  };
  /**
   * 셀 id는 토픽의 {cell}, site는 토픽의 {site}와 같다
   *
   * @minItems 1
   */
  cells: [
    {
      id: KebabId;
      name: string;
      pose: Pose;
      plate: {
        /**
         * [가로 X, 세로 Y]
         *
         * @minItems 2
         * @maxItems 2
         */
        size_mm: [number, number];
        pose: Pose;
      };
      robot: {
        /**
         * URDF 경로(public 기준). 준비 전이면 null
         */
        urdf: string | null;
        pose: Pose;
      };
      camera?: {
        /**
         * MJPEG 주소
         */
        stream?: string | null;
      };
    },
    ...{
      id: KebabId;
      name: string;
      pose: Pose;
      plate: {
        /**
         * [가로 X, 세로 Y]
         *
         * @minItems 2
         * @maxItems 2
         */
        size_mm: [number, number];
        pose: Pose;
      };
      robot: {
        /**
         * URDF 경로(public 기준). 준비 전이면 null
         */
        urdf: string | null;
        pose: Pose;
      };
      camera?: {
        /**
         * MJPEG 주소
         */
        stream?: string | null;
      };
    }[]
  ];
  /**
   * @minItems 1
   */
  presets: [
    {
      id: KebabId;
      name: string;
      eye_m: Vec3;
      target_m: Vec3;
    },
    ...{
      id: KebabId;
      name: string;
      eye_m: Vec3;
      target_m: Vec3;
    }[]
  ];
}
/**
 * 부모 좌표계 기준 자세. 셀은 사이트 기준, 작업판(원점 모서리, 윗면 높이)과 로봇 베이스는 셀 기준
 */
export interface Pose {
  position_m: Vec3;
  /**
   * Z축 회전(deg). position_m은 위치(m)
   */
  yaw_deg: number;
}

/**
 * innoworks/{site}/{cell}/status. 서버→웹, retained. offline은 브로커가 LWT로 대신 발행한다.
 */
export interface Status {
  v: 1;
  ts: number;
  state: 'online' | 'offline';
}

/**
 * innoworks/{site}/{cell}/task/progress. 서버→웹, QoS 0.
 */
export interface TaskProgress {
  v: 1;
  ts: number;
  task_id: string;
  /**
   * 경로 길이 기준 완료 비율
   */
  progress: number;
}

/**
 * innoworks/{site}/{cell}/task/proposal. 서버→웹, QoS 1, retained. AI가 제안한 용접 경로.
 */
export interface TaskProposal {
  v: 1;
  ts: number;
  task_id: string;
  /**
   * 작업판 좌표(mm) 점 배열, 시작 → 끝
   *
   * @minItems 2
   */
  path: [[number, number], [number, number], ...[number, number][]];
  confidence?: number;
}

/**
 * innoworks/{site}/{cell}/task/snap. 서버→웹, QoS 1. 드래그 경로를 용접선으로 수렴시킨 결과.
 */
export interface TaskSnap {
  v: 1;
  ts: number;
  task_id: string;
  /**
   * false면 수렴 실패. path는 사용자가 그린 경로 그대로
   */
  ok: boolean;
  /**
   * 작업판 좌표(mm) 점 배열, 시작 → 끝
   *
   * @minItems 2
   */
  path: [[number, number], [number, number], ...[number, number][]];
}

/**
 * innoworks/{site}/{cell}/task/state. 서버→웹, QoS 1, retained. 상태 이름은 초안이며 서버 상태 머신 문서에서 확정한다.
 */
export interface TaskState {
  v: 1;
  ts: number;
  /**
   * idle 대기, proposed 승인 대기, editing 수정 중, running 실행 중, completed 확인 대기, paused 일시정지, estopped 긴급정지
   */
  state: 'idle' | 'proposed' | 'editing' | 'running' | 'completed' | 'paused' | 'estopped';
  /**
   * 서버가 발급. idle이면 null
   */
  task_id: string | null;
}

export const TOPIC_PREFIX = 'innoworks';

/** 셀 토픽 접미사 → payload 타입 */
export interface CellTopicPayloads {
  'robot/state': RobotState;
  'task/state': TaskState;
  'task/proposal': TaskProposal;
  'task/snap': TaskSnap;
  'task/progress': TaskProgress;
  'alarm': Alarm;
  'status': Status;
}

export type CellTopicSuffix = keyof CellTopicPayloads;

export const CELL_TOPIC_SUFFIXES: readonly CellTopicSuffix[] = ['robot/state', 'task/state', 'task/proposal', 'task/snap', 'task/progress', 'alarm', 'status'];
