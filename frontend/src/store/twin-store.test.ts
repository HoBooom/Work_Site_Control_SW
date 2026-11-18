import { beforeEach, describe, expect, it } from 'vitest';
import { JOINT_SAMPLES_KEPT, useTwinStore } from './twin-store';

const T = 'innoworks/shipyard/weld-cell-1';
const cell = () => useTwinStore.getState().cells['shipyard/weld-cell-1'];
const apply = (suffix: string, payload: object, at = 0) =>
  useTwinStore.getState().apply(`${T}/${suffix}`, { v: 1, ts: 1, ...payload }, at);

describe('twin store', () => {
  beforeEach(() => useTwinStore.getState().reset());

  it('셀 토픽이 아니면 무시한다', () => {
    expect(useTwinStore.getState().apply('innoworks/operator/x/heartbeat', {}, 0)).toBe(false);
    expect(useTwinStore.getState().cells).toEqual({});
  });

  it('status와 관절각을 반영한다', () => {
    apply('status', { state: 'online' });
    apply('robot/state', { ts: 42, joints: { joint_1: 10 } });
    expect(cell().online).toBe(true);
    expect(cell().joints).toEqual({ joint_1: 10 });
    expect(cell().jointsTs).toBe(42);
    apply('status', { state: 'offline' });
    expect(cell().online).toBe(false);
  });

  it('관절 샘플을 수신 시각과 함께 최근 것만 남긴다', () => {
    for (let i = 0; i < JOINT_SAMPLES_KEPT + 3; i++) apply('robot/state', { ts: i, joints: { joint_1: i } }, i * 100);
    const s = cell().jointSamples;
    expect(s).toHaveLength(JOINT_SAMPLES_KEPT);
    expect(s[0]).toEqual({ at: 300, ts: 3, joints: { joint_1: 3 } });
    expect(s.at(-1)?.at).toBe((JOINT_SAMPLES_KEPT + 2) * 100);
  });

  it('알람은 active=false로 해제된다', () => {
    apply('alarm', { alarm_id: 'a1', severity: 'warning', code: 'X', message: 'm', active: true });
    apply('alarm', { alarm_id: 'a2', severity: 'critical', code: 'Y', message: 'm', active: true });
    expect(Object.keys(cell().alarms).sort()).toEqual(['a1', 'a2']);
    apply('alarm', { alarm_id: 'a1', severity: 'warning', code: 'X', message: 'm', active: false });
    expect(Object.keys(cell().alarms)).toEqual(['a2']);
  });

  it('작업이 바뀌면 이전 경로·진행률을 버린다', () => {
    apply('task/state', { state: 'proposed', task_id: 't1' });
    apply('task/proposal', { task_id: 't1', path: [[0, 0], [100, 0]] });
    apply('task/progress', { task_id: 't1', progress: 0.5 });
    apply('task/state', { state: 'running', task_id: 't1' });
    expect(cell().proposal?.task_id).toBe('t1');
    expect(cell().progress?.progress).toBe(0.5);
    apply('task/state', { state: 'idle', task_id: null });
    expect(cell().proposal).toBeNull();
    expect(cell().progress).toBeNull();
  });

  it('새 제안이 오면 이전 수렴 결과를 버린다', () => {
    apply('task/snap', { task_id: 't1', ok: true, path: [[0, 0], [1, 1]] });
    apply('task/proposal', { task_id: 't1', path: [[0, 0], [2, 2]] });
    expect(cell().snap).toBeNull();
  });
});
