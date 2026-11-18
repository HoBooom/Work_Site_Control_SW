import { describe, expect, it } from 'vitest';
import { autoQuality, QUALITY } from './quality';

describe('autoQuality', () => {
  it('작은 터치 기기는 low', () => {
    expect(autoQuality({ maxTouchPoints: 5, screenWidth: 1180, screenHeight: 820 })).toBe('low'); // iPad Air
    expect(autoQuality({ maxTouchPoints: 5, screenWidth: 390, screenHeight: 844 })).toBe('low');
  });

  it('터치가 없거나 큰 화면이면 high', () => {
    expect(autoQuality({ maxTouchPoints: 0, screenWidth: 1280, screenHeight: 720 })).toBe('high');
    expect(autoQuality({ maxTouchPoints: 10, screenWidth: 2560, screenHeight: 1600 })).toBe('high');
  });

  it('low는 high보다 가볍다', () => {
    expect(QUALITY.low.shadowMapSize).toBeLessThan(QUALITY.high.shadowMapSize);
    expect(QUALITY.low.ssao).toBe(false);
    expect(QUALITY.low.msaa).toBe(0);
  });
});
