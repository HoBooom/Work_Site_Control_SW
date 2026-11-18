import type { SiteConfig } from '../contracts/messages.gen';
import { surfaceCorners } from './surface';

/** 카메라 목표점이 머무를 수 있는 사이트 영역(사이트 좌표, m). 셀 원점, 프리셋 목표, 강판 면(surfaces)을 감싸고 여유를 둔다. 그림자 범위도 이것을 쓴다. */
export interface SiteBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export const BOUNDS_MARGIN_M = 6;
export const TARGET_MAX_HEIGHT_M = 3;

export function siteBounds(config: SiteConfig, margin = BOUNDS_MARGIN_M): SiteBounds {
  const pts = [
    ...config.cells.map((c) => c.pose.position_m),
    ...config.presets.map((p) => p.target_m),
    ...(config.surfaces ?? []).flatMap(surfaceCorners),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    min: [Math.min(...xs) - margin, Math.min(...ys) - margin, 0],
    max: [Math.max(...xs) + margin, Math.max(...ys) + margin, TARGET_MAX_HEIGHT_M],
  };
}

export function clampToBounds(p: [number, number, number], b: SiteBounds): [number, number, number] {
  return [0, 1, 2].map((i) => Math.min(b.max[i], Math.max(b.min[i], p[i]))) as [number, number, number];
}
