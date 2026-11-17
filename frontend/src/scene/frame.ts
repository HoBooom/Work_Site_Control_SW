/**
 * 좌표계 변환.
 * 사이트 좌표계: USD와 같음. Z-up, m. site-config의 모든 좌표가 이 좌표계다.
 * 씬 좌표계: three.js. Y-up, m. 사이트 좌표계를 X축으로 -90° 돌린 것.
 */
export type V3 = [number, number, number];

/** 사이트 그룹에 걸 회전. 그룹 안에서는 사이트 좌표를 그대로 쓴다. */
export const SITE_TO_SCENE_ROTATION_X = -Math.PI / 2;

export function siteToScene([x, y, z]: V3): V3 {
  return [x, z, -y];
}

export const deg = (d: number) => (d * Math.PI) / 180;
