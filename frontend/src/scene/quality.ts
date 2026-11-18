/** RD-05 품질 등급(spec 2절 표). 노트북 high, 태블릿 low. */
export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  dpr: [number, number];
  /** 후처리 MSAA 샘플 수 */
  msaa: number;
  shadowMapSize: number;
  /** PCF 그림자 경계 흐림 반경. three 0.187에서 PCFSoftShadowMap이 없어져 PCF + radius로 부드럽게 한다 */
  shadowRadius: number;
  ssao: boolean;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { dpr: [1, 2], msaa: 4, shadowMapSize: 2048, shadowRadius: 4, ssao: true },
  low: { dpr: [1, 1.5], msaa: 0, shadowMapSize: 1024, shadowRadius: 1, ssao: false },
};

/** 화면이 작은 터치 기기면 low. 큰 터치 노트북은 high로 둔다 */
export const LOW_TIER_MAX_SCREEN_PX = 1400;

export function autoQuality(env: { maxTouchPoints: number; screenWidth: number; screenHeight: number }): QualityTier {
  const longSide = Math.max(env.screenWidth, env.screenHeight);
  return env.maxTouchPoints > 0 && longSide < LOW_TIER_MAX_SCREEN_PX ? 'low' : 'high';
}

export function detectQuality(): QualityTier {
  return autoQuality({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  });
}
