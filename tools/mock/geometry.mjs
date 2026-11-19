// 픽셀 ↔ 면 mm 변환(호모그래피)과 경로 수렴(Mock). 실제 서버의 snap/은 확률 맵 기반이다(server/docs).

/** 대응점 4쌍([{ px: [x, y], mm: [x, y] }])으로 px → mm 호모그래피(3x3, 행 우선) */
export function homography(pairs) {
  if (pairs.length !== 4) throw new Error('대응점은 4쌍이다');
  const A = [];
  const b = [];
  for (const { px: [x, y], mm: [u, v] } of pairs) {
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('대응점이 한 직선 위에 있다');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function apply(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const round1 = (v) => Math.round(v * 10) / 10;
export const toMm = (H, pts) => pts.map((p) => apply(H, p).map(round1));

/** 점 p에서 꺾은선 line까지 가장 가까운 점과 거리 */
export function nearestOnPolyline(line, [x, y]) {
  let best = { point: line[0], dist: Infinity, s: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const q = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(x - q[0], y - q[1]);
    const segLen = Math.sqrt(len2);
    if (d < best.dist) best = { point: q, dist: d, s: acc + t * segLen };
    acc += segLen;
  }
  return best;
}

/**
 * Mock 수렴: 사용자가 그린 선의 양 끝을 용접선 위로 붙이고, 그 사이의 용접선을 n점으로 다시 고른다.
 * 그린 선이 용접선에서 평균 maxMeanPx 넘게 떨어져 있으면 실패(ok=false, 그린 선 그대로).
 */
export function snapToSeam(seam, drawn, { maxMeanPx = 40, n = 9 } = {}) {
  const mean = drawn.reduce((s, p) => s + nearestOnPolyline(seam, p).dist, 0) / drawn.length;
  if (mean > maxMeanPx) return { ok: false, path_px: drawn.map((p) => p.map(round1)), meanPx: mean };
  let s0 = nearestOnPolyline(seam, drawn[0]).s;
  let s1 = nearestOnPolyline(seam, drawn[drawn.length - 1]).s;
  if (s1 < s0) [s0, s1] = [s1, s0];
  const path = [];
  for (let i = 0; i < n; i++) path.push(pointAt(seam, s0 + ((s1 - s0) * i) / (n - 1)).map(round1));
  return { ok: true, path_px: path, meanPx: mean };
}

function pointAt(line, s) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (acc + len >= s || i === line.length - 2) {
      const t = len ? Math.max(0, Math.min(1, (s - acc) / len)) : 0;
      return [ax + t * (bx - ax), ay + t * (by - ay)];
    }
    acc += len;
  }
  return line[line.length - 1];
}
