import { describe, expect, it } from 'vitest';
import { cellTopic, parseCellTopic } from './topics';

describe('parseCellTopic', () => {
  it('셀 토픽을 나눈다', () => {
    expect(parseCellTopic('innoworks/shipyard/weld-cell-1/robot/state')).toEqual({
      site: 'shipyard',
      cell: 'weld-cell-1',
      suffix: 'robot/state',
    });
    expect(parseCellTopic('innoworks/factory/cell-a/alarm')?.suffix).toBe('alarm');
  });

  it('셀 토픽이 아니면 null', () => {
    expect(parseCellTopic('innoworks/operator/abc/heartbeat')).toBeNull();
    expect(parseCellTopic('other/shipyard/weld-cell-1/status')).toBeNull();
    expect(parseCellTopic('innoworks/shipyard/weld-cell-1/robot/unknown')).toBeNull();
    expect(parseCellTopic('innoworks/shipyard')).toBeNull();
  });

  it('cellTopic과 왕복한다', () => {
    const t = cellTopic('shipyard', 'weld-cell-2', 'task/proposal');
    expect(parseCellTopic(t)).toEqual({ site: 'shipyard', cell: 'weld-cell-2', suffix: 'task/proposal' });
  });
});
