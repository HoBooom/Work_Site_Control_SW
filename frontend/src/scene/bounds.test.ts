import { describe, expect, it } from 'vitest';
import type { SiteConfig } from '../contracts/messages.gen';
import { clampToBounds, siteBounds } from './bounds';

const config = {
  cells: [{ pose: { position_m: [0, 0, 0] } }, { pose: { position_m: [2, 4, 0] } }],
  presets: [{ target_m: [1, 10, 0.5] }],
} as unknown as SiteConfig;

describe('siteBounds', () => {
  it('셀과 프리셋 목표를 감싸고 여유를 둔다', () => {
    expect(siteBounds(config, 1)).toEqual({ min: [-1, -1, 0], max: [3, 11, 3] });
  });

  it('영역 밖 점을 경계로 붙인다', () => {
    const b = siteBounds(config, 1);
    expect(clampToBounds([100, -100, -5], b)).toEqual([3, -1, 0]);
    expect(clampToBounds([1, 1, 1], b)).toEqual([1, 1, 1]);
  });
});
