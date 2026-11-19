/**
 * UI-03: 원본 프레임 픽셀 ↔ 화면에 그린 영상(object-fit: contain) 좌표. 경로는 원본 픽셀로 보관하고 그릴 때만 바꾼다(frontend 핵심 규칙).
 */
export interface Fit {
  /** 영상이 그려진 상자 안에서의 왼쪽 위(빈 띠 포함 보정) */
  x: number;
  y: number;
  /** 원본 1px당 화면 px */
  scale: number;
}

/** 상자(boxW × boxH)에 원본(frameW × frameH)을 비율 유지로 넣었을 때의 배치 */
export function fitContain(frameW: number, frameH: number, boxW: number, boxH: number): Fit {
  const scale = Math.min(boxW / frameW, boxH / frameH);
  return { scale, x: (boxW - frameW * scale) / 2, y: (boxH - frameH * scale) / 2 };
}

export const frameToBox = (f: Fit, [x, y]: readonly number[]): [number, number] => [f.x + x * f.scale, f.y + y * f.scale];
export const boxToFrame = (f: Fit, [x, y]: readonly number[]): [number, number] => [(x - f.x) / f.scale, (y - f.y) / f.scale];

/** 꺾은선을 길이 비율 k(0~1)에서 나눈다(진행률만큼 완료 구간) */
export function splitAt(points: readonly (readonly number[])[], k: number): { done: [number, number][]; todo: [number, number][] } {
  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  if (pts.length < 2 || k <= 0) return { done: [], todo: pts };
  if (k >= 1) return { done: pts, todo: [] };
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let left = total * k;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const t = seg[i] ? left / seg[i] : 0;
      const cut: [number, number] = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      return { done: [...pts.slice(0, i + 1), cut], todo: [cut, ...pts.slice(i + 1)] };
    }
    left -= seg[i];
  }
  return { done: pts, todo: [] };
}
