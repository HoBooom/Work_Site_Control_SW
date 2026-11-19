// Mock 카메라 그림: 강판·용접선을 절차적으로 그린 PNG(사용자 결정: 개발 중에는 아무 사진이나). 저장소에 그림 파일을 두지 않는다.
// 종류마다 그림 위 용접선(픽셀 꺾은선)과 면 mm 대응점 4쌍을 함께 만든다. 서버의 픽셀 → mm 변환(호모그래피)이 그대로 트윈의 용접선이 된다.
import { deflateSync } from 'node:zlib';
import { homography } from './geometry.mjs';

export const FRAME_W = 1280;
export const FRAME_H = 720;

/** 결정적 잡음 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** 값 잡음(부드러운 얼룩) */
function smoothNoise(x, y, scale, seed) {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 이음 꺾은선(끝점 a → b, 살짝 휨) */
function seamLine(a, b, bow, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const L = Math.hypot(nx, ny);
    const k = bow * Math.sin(Math.PI * t);
    out.push([Math.round((x + (nx / L) * k) * 10) / 10, Math.round((y + (ny / L) * k) * 10) / 10]);
  }
  return out;
}

/** 꺾은선까지 부호 있는 거리(왼쪽 +). 근사: 가장 가까운 선분 */
function sideOf(line, x, y) {
  let best = Infinity;
  let sign = 1;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best) {
      best = d;
      sign = dx * (y - ay) - dy * (x - ax) > 0 ? 1 : -1;
    }
  }
  return best * sign;
}

const KINDS = {
  // 바닥 외판 + 론지 웹(위쪽, 프라이머 빨강)의 필릿 이음. 아래로 갈수록 가깝다
  // side: 이음 진행 방향의 한쪽(sideOf > 0)에 칠할 색, other: 반대쪽. 먼 대응점(pxFar)이 있는 쪽이 면(회색)이다
  fillet: { a: [110, 420], b: [1170, 380], bow: 7, mmOffset: [0, -320], pxFar: [[1270, 712], [12, 712]], upper: [148, 151, 155], lower: [120, 46, 34] },
  // 측면 외판(오른쪽, 회색) + 늑판(왼쪽, 빨강)의 수직 이음
  vertical: { a: [655, 50], b: [628, 690], bow: -5, mmOffset: [700, 0], pxFar: [[1268, 700], [1268, 30]], upper: [118, 44, 33], lower: [140, 144, 149] },
  // 평판 위 맞대기 이음(고정 로봇 작업판)
  plate: { a: [140, 380], b: [1150, 340], bow: 4, mmOffset: [0, -200], pxFar: [[1220, 690], [80, 700]], upper: [150, 153, 157], lower: [146, 149, 153] },
};

/**
 * @param {{ kind: 'fillet'|'vertical'|'plate', seam_mm: number[][], seed?: number }} opts
 * @returns {{ size: number[], seam_px: number[][], H: number[], png: Buffer }}
 */
const cache = new Map();

export function makeFrame({ kind, seam_mm, seed = 1 }) {
  // 같은 인자면 같은 그림(결정적). Mock 서버를 여러 번 띄우는 검사가 다시 그리지 않게 둔다
  const key = JSON.stringify([kind, seam_mm, seed]);
  if (!cache.has(key)) cache.set(key, draw({ kind, seam_mm, seed }));
  return cache.get(key);
}

function draw({ kind, seam_mm, seed }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`모르는 영상 종류: ${kind}`);
  const seam_px = seamLine(k.a, k.b, k.bow);
  const [m0, m1] = seam_mm;
  const off = k.mmOffset;
  // 이음 끝점 ↔ 용접선 끝점, 먼 두 점 ↔ 용접선에서 mmOffset만큼 떨어진 점
  const H = homography([
    { px: k.a, mm: m0 },
    { px: k.b, mm: m1 },
    { px: k.pxFar[0], mm: [m1[0] + off[0], m1[1] + off[1]] },
    { px: k.pxFar[1], mm: [m0[0] + off[0], m0[1] + off[1]] },
  ]);
  const rnd = rng(seed);
  const spatter = Array.from({ length: 140 }, () => {
    const t = rnd();
    const i = Math.min(seam_px.length - 2, Math.floor(t * (seam_px.length - 1)));
    const p = seam_px[i];
    return [p[0] + (rnd() - 0.5) * 160, p[1] + (rnd() - 0.5) * 120, 1 + rnd() * 2.5];
  });
  const tacks = [0.12, 0.38, 0.63, 0.88].map((t) => {
    const i = Math.round(t * (seam_px.length - 1));
    return seam_px[i];
  });
  // 스패터·가접은 먼저 마스크에 찍는다(화소마다 모든 점을 보지 않게)
  const dark = new Float32Array(FRAME_W * FRAME_H).fill(1);
  const bead = new Float32Array(FRAME_W * FRAME_H);
  const stamp = (cx, cy, rx, ry, f) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(FRAME_H - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(FRAME_W - 1, Math.ceil(cx + rx)); x++) {
        const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (q < 1) f(y * FRAME_W + x, q);
      }
    }
  };
  for (const [sx, sy, sr] of spatter) stamp(sx, sy, sr, sr, (i) => (dark[i] = 0.55));
  for (const [tx, ty] of tacks) stamp(tx, ty, 16, 6, (i, q) => (bead[i] = Math.max(bead[i], 1 - q)));
  const rgb = Buffer.alloc(FRAME_W * FRAME_H * 3);
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const d = sideOf(seam_px, x, y);
      const upper = d > 0;
      const base = upper ? k.upper : k.lower;
      // 조명: 화면 가운데가 밝고, 이음 쪽 구석은 그늘
      const vign = 1 - 0.35 * (((x - FRAME_W / 2) / FRAME_W) ** 2 + ((y - FRAME_H / 2) / FRAME_H) ** 2) * 2;
      const corner = Math.min(1, Math.abs(d) / 40);
      const shade = (0.72 + 0.28 * corner) * vign;
      const mottle = 0.86 + 0.22 * smoothNoise(x, y, 60, seed) + 0.08 * smoothNoise(x, y, 9, seed + 3);
      const brushed = upper ? 1 : 0.97 + 0.06 * hash2(Math.floor(y / 2), 0, seed + 7);
      const grain = 0.94 + 0.12 * hash2(x, y, seed + 11);
      let r = base[0] * shade * mottle * brushed * grain;
      let g = base[1] * shade * mottle * brushed * grain;
      let b = base[2] * shade * mottle * brushed * grain;
      // 이음 홈(어두운 선)
      const groove = Math.exp(-(d * d) / 6);
      r *= 1 - 0.55 * groove;
      g *= 1 - 0.55 * groove;
      b *= 1 - 0.55 * groove;
      const i = y * FRAME_W + x;
      // 가접(tack) 비드: 가운데가 볼록하게 밝은 회색
      if (bead[i] > 0) {
        const h = (0.62 + 0.38 * Math.sqrt(bead[i])) * vign;
        r = r * (1 - bead[i]) + 168 * h * bead[i];
        g = g * (1 - bead[i]) + 166 * h * bead[i];
        b = b * (1 - bead[i]) + 160 * h * bead[i];
      }
      // 스패터
      r *= dark[i];
      g *= dark[i];
      b *= dark[i] * 1.05;
      const o = i * 3;
      rgb[o] = Math.max(0, Math.min(255, r));
      rgb[o + 1] = Math.max(0, Math.min(255, g));
      rgb[o + 2] = Math.max(0, Math.min(255, b));
    }
  }
  return { size: [FRAME_W, FRAME_H], seam_px, H, png: png(FRAME_W, FRAME_H, rgb) };
}
