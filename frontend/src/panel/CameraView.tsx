import { useEffect, useRef } from 'react';
import { useMedia } from '../app/bus-context';
import { COLORS, cellVisualState } from '../scene/cell-view';
import { cellKey, useTwinStore } from '../store/twin-store';
import { fitContain, frameToBox, splitAt, type Fit } from './overlay';

/** 패널마다 마지막으로 그린 경로(화면 좌표). window.__app.overlay()가 읽는다(검사용) */
export const overlayDebug = new Map<string, { points: [number, number][]; fit: Fit; box: [number, number]; frameSize: [number, number]; src: string }>();

/**
 * UI-03: 카메라 영상 + 경로 오버레이. 영상은 서버의 /stream/{cell}(수정 중이면 멈춘 프레임 /frames/{frame_id}).
 * 경로(path_px, 원본 프레임 픽셀)를 영상 위 canvas에 그린다. 실행 중이면 진행률만큼 완료 색.
 */
export function CameraView({ site, cellId, name }: { site: string; cellId: string; name: string }) {
  const media = useMedia();
  const c = useTwinStore((s) => s.cells[cellKey(site, cellId)]);
  const state = cellVisualState(c);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = c?.proposal ?? null;
  const shown = c?.snap && c.snap.task_id === c.task?.task_id && c.snap.path_px ? c.snap : src;
  const [fw, fh] = shown?.frame_size ?? src?.frame_size ?? [1280, 720];
  const imgSrc = state === 'editing' && src?.frame_id ? `${media}/frames/${src.frame_id}` : `${media}/stream/${cellId}`;
  const progress = c?.progress?.task_id === c?.task?.task_id ? (c?.progress?.progress ?? 0) : 0;
  const path = shown?.path_px ?? null;

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const fit = fitContain(fw, fh, w, h);
      if (!path || path.length < 2 || state === 'idle' || state === 'unknown') {
        overlayDebug.delete(cellId);
        return;
      }
      const pts = path.map((p) => frameToBox(fit, p));
      const k = state === 'completed' ? 1 : state === 'running' || state === 'paused' || state === 'estopped' ? progress : 0;
      const { done, todo } = splitAt(pts, k);
      const line = (p: [number, number][], color: string, dashed: boolean) => {
        if (p.length < 2) return;
        ctx.save();
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = state === 'offline' ? COLORS.dim : color;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 3;
        if (dashed) ctx.setLineDash([12, 8]);
        ctx.beginPath();
        p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      };
      line(done, COLORS.seamDone, false);
      line(todo, COLORS.seamTodo, state === 'editing');
      // 시작점 표시
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], 5, 0, Math.PI * 2);
      ctx.fill();
      overlayDebug.set(cellId, { points: pts, fit, box: [w, h], frameSize: [fw, fh], src: imgSrc });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [path, fw, fh, state, progress, cellId, imgSrc]);

  return (
    <div className="camera" ref={box} data-testid="camera" data-src={imgSrc}>
      <img src={imgSrc} alt={`${name} 카메라`} draggable={false} />
      <canvas ref={canvas} data-testid="overlay" style={{ position: 'absolute', inset: 0 }} />
      {state === 'editing' && <div className="camera-tag">멈춘 영상</div>}
    </div>
  );
}
