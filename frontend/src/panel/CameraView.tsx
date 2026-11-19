import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMedia } from '../app/bus-context';
import { COLORS, cellVisualState } from '../scene/cell-view';
import { cellKey, useTwinStore } from '../store/twin-store';
import { fitContain, frameToBox, polylineLength, splitAt, strokeToFrame, type Fit } from './overlay';

/** 패널마다 마지막으로 그린 경로(화면 좌표). window.__app.overlay()가 읽는다(검사용) */
export const overlayDebug = new Map<string, { points: [number, number][]; fit: Fit; box: [number, number]; frameSize: [number, number]; src: string; mode: 'view' | 'edit'; failed: boolean }>();

const SNAP_FAILED_COLOR = '#f0883e';
const STROKE_COLOR = '#ffd34e';
/** 이보다 짧게 그린 선(화면 px)은 실수로 보고 보내지 않는다 */
const MIN_STROKE_PX = 20;

/**
 * UI-03: 카메라 영상 + 경로 오버레이. 영상은 서버의 /stream/{cell}(수정 중이면 멈춘 프레임 /frames/{frame_id}).
 * 경로(path_px, 원본 프레임 픽셀)를 영상 위 canvas에 그린다. 실행 중이면 진행률만큼 완료 색.
 * UI-05 수정 모드: 멈춘 프레임 위에 Pointer Events(마우스·터치·펜)로 그린다. 그리는 선은 화면 혼자 그리고,
 * 손을 떼면 원본 픽셀 경로로 바꿔 onDraw를 한 번 부른다(패널이 cmd/drag를 보낸다). 수정 중에는 스크롤을 막는다.
 */
export function CameraView({ site, cellId, name, onDraw, drawPending }: { site: string; cellId: string; name: string; onDraw?: (path_px: [number, number][], frameId: string) => void; drawPending?: boolean }) {
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
  const failed = !!(shown && 'ok' in shown && shown.ok === false);
  // 수렴에 실패하면 제안 경로(빨간 점선, 다시 그릴 기준)와 실패한 선(주황 점선)을 함께 보인다
  const path = (failed ? src?.path_px : shown?.path_px) ?? null;
  const failedPath = failed ? (shown?.path_px ?? null) : null;
  const editing = state === 'editing' && !!src?.frame_id && !!onDraw;
  // 그리는 중·보낸 뒤 응답 전의 선(화면 좌표). 서버의 새 경로가 오면 지운다
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  const drawing = useRef(false);
  const fitRef = useRef<Fit | null>(null);
  useEffect(() => {
    if (!drawPending) setStroke(null);
  }, [path, drawPending]);
  useEffect(() => {
    if (!editing) setStroke(null);
  }, [editing]);

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
      fitRef.current = fit;
      const drawStroke = () => {
        if (!stroke || stroke.length < 2) return;
        ctx.save();
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = drawPending ? 'rgba(255,255,255,0.8)' : STROKE_COLOR;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      };
      if (!path || path.length < 2 || state === 'idle' || state === 'unknown') {
        overlayDebug.delete(cellId);
        drawStroke();
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
      if (failedPath && failedPath.length >= 2) line(failedPath.map((p) => frameToBox(fit, p)), SNAP_FAILED_COLOR, true);
      drawStroke();
      // 시작점 표시
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], 5, 0, Math.PI * 2);
      ctx.fill();
      overlayDebug.set(cellId, { points: pts, fit, box: [w, h], frameSize: [fw, fh], src: imgSrc, mode: editing ? 'edit' : 'view', failed });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [path, failedPath, fw, fh, state, progress, cellId, imgSrc, stroke, drawPending, failed, editing]);

  // 수정 모드 그리기: 마우스·터치·펜 모두 Pointer Events 하나로
  const at = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editing || drawPending || !e.isPrimary) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // 캔버스 밖으로 나가도 이어 그린다
    } catch {
      // 합성 이벤트 등 포인터 id가 없으면 잡지 않고 그린다
    }
    drawing.current = true;
    setStroke([at(e)]);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = at(e);
    setStroke((s) => (s ? [...s, p] : [p]));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const s = stroke ? [...stroke, at(e)] : [at(e)];
    const fit = fitRef.current;
    if (!fit || !src?.frame_id || polylineLength(s) < MIN_STROKE_PX) {
      setStroke(null);
      return;
    }
    setStroke(s);
    onDraw?.(strokeToFrame(fit, fw, fh, s), src.frame_id);
  };

  return (
    <div className={editing ? 'camera camera-edit' : 'camera'} ref={box} data-testid="camera" data-src={imgSrc} data-mode={editing ? 'edit' : 'view'}>
      <img src={imgSrc} alt={`${name} 카메라`} draggable={false} />
      <canvas
        ref={canvas}
        data-testid="overlay"
        style={{ position: 'absolute', inset: 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drawing.current = false;
          setStroke(null);
        }}
      />
      {state === 'editing' && <div className="camera-tag">멈춘 영상 · 용접선을 따라 그린다</div>}
    </div>
  );
}
