import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CommandPayloads, SiteConfig } from '../contracts/messages.gen';
import { useBus } from '../app/bus-context';
import { CameraView } from './CameraView';
import { HINT, controlsFor, type ControlId } from './controls';
import { STATE_STYLE, cellVisualState } from '../scene/cell-view';
import { useSelection } from '../scene/selection';
import { cellKey, useTwinStore } from '../store/twin-store';

/**
 * 사이드 패널(UI-01, UI-02). 로봇을 고르지 않았으면 로봇 목록, 고르면 그 로봇의 영상·작업·메트릭.
 * 작업 버튼은 서버 상태로만 활성화하고(UI-04), 명령을 보낸 뒤에는 서버 응답(상태 변화나 거부 알람)이 올 때까지 기다린다.
 */
export function Panel({ config }: { config: SiteConfig }) {
  const selected = useSelection((s) => s.selected);
  const cell = selected?.site === config.site ? config.cells.find((c) => c.id === selected.cell) : undefined;
  return cell ? <UnitPanel site={config.site} cellId={cell.id} name={cell.name} /> : <RobotList config={config} />;
}

function RobotList({ config }: { config: SiteConfig }) {
  const select = useSelection((s) => s.select);
  const states = useTwinStore(useShallow((s) => config.cells.map((c) => cellVisualState(s.cells[cellKey(config.site, c.id)]))));
  return (
    <div data-testid="robot-list">
      <div className="panel-section panel-title">로봇 {config.cells.length}대</div>
      {config.cells.map((c, i) => {
        const st = STATE_STYLE[states[i]];
        return (
          <button
            key={c.id}
            className="robot-row"
            data-testid={`robot-row-${c.id}`}
            data-state={states[i]}
            onClick={() => select({ site: config.site, cell: c.id, kind: 'robot', id: c.id })}
          >
            <span className="dot" style={{ background: st.lamp }} />
            <strong style={{ flex: 1 }}>{c.name}</strong>
            <span>{st.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 명령을 보낸 뒤 응답을 기다리는 최대 시간. 넘으면 버튼을 다시 연다(서버가 응답하지 않은 것) */
const PENDING_TIMEOUT_MS = 5000;

function UnitPanel({ site, cellId, name }: { site: string; cellId: string; name: string }) {
  const bus = useBus();
  const select = useSelection((s) => s.select);
  const c = useTwinStore((s) => s.cells[cellKey(site, cellId)]);
  const state = cellVisualState(c);
  const st = STATE_STYLE[state];
  const progress = c?.progress?.task_id === c?.task?.task_id ? (c?.progress?.progress ?? 0) : 0;
  const [pending, setPending] = useState<{ cmdId: string; task: unknown; snap: unknown; kind: 'cmd' | 'drag' } | null>(null);

  // 서버 응답: 작업 상태가 바뀌었거나, 수렴 결과(task/snap)가 왔거나, 이 명령의 거부 알람이 왔으면 기다림을 끝낸다
  useEffect(() => {
    if (!pending) return;
    const rejected = Object.values(c?.alarms ?? {}).some((a) => a.cmd_id === pending.cmdId);
    if (c?.task !== pending.task || c?.snap !== pending.snap || rejected) setPending(null);
  }, [c?.task, c?.snap, c?.alarms, pending]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const send = (id: ControlId) => {
    if (!bus) return;
    const task_id = c?.task?.task_id ?? '';
    let cmdId: string;
    switch (id) {
      case 'approve':
        cmdId = bus.command(cellId, 'cmd/approve', { task_id });
        break;
      case 'edit':
        cmdId = bus.command(cellId, 'cmd/edit_start', { task_id });
        break;
      case 'confirm-ok':
        cmdId = bus.command(cellId, 'cmd/confirm', { task_id, result: 'ok' });
        break;
      case 'confirm-rework':
        cmdId = bus.command(cellId, 'cmd/confirm', { task_id, result: 'rework' });
        break;
      case 'resume':
        cmdId = bus.command(cellId, 'cmd/resume', {});
        break;
      case 'estop':
        bus.command(cellId, 'cmd/estop', { reason: '로봇별 정지' });
        return; // 정지는 기다리지 않는다(언제나 다시 누를 수 있게)
    }
    // 화면은 바꾸지 않는다: 서버의 task/state가 오면 바뀐다(frontend 핵심 규칙)
    setPending({ cmdId, task: c?.task, snap: c?.snap, kind: 'cmd' });
  };

  /** UI-05: 손을 뗄 때 한 번. 그린 경로(원본 픽셀)를 서버가 용접선으로 수렴시킨다 */
  const sendDrag = (path_px: [number, number][], frame_id: string) => {
    if (!bus || !c?.task?.task_id || path_px.length < 2) return;
    const path = path_px as CommandPayloads['cmd/drag']['path_px']; // 계약: 2점 이상(위에서 확인)
    const cmdId = bus.command(cellId, 'cmd/drag', { task_id: c.task.task_id, frame_id, path_px: path });
    setPending({ cmdId, task: c.task, snap: c.snap, kind: 'drag' });
  };

  const connected = !!bus && c?.online !== false;
  const controls = controlsFor(state, !!pending, connected);
  const CLASS: Record<ControlId, string> = {
    edit: 'btn btn-ghost',
    approve: 'btn btn-primary',
    'confirm-ok': 'btn btn-ok',
    'confirm-rework': 'btn btn-warn',
    resume: 'btn btn-warn',
    estop: 'btn btn-estop',
  };
  return (
    <div data-testid="unit-panel" data-cell={cellId} data-state={state} data-pending={pending ? '1' : '0'}>
      <div className="panel-section" style={{ display: 'grid', gap: 8 }}>
        <div className="panel-title">
          <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={() => select(null)} aria-label="로봇 목록으로">
            ←
          </button>
          <span className="dot" style={{ background: st.lamp }} />
          <span style={{ flex: 1 }}>{name}</span>
          <span className="badge" data-testid="unit-state" style={{ background: st.lamp }}>
            {st.label}
          </span>
        </div>
        <div className="kv">
          <span>작업</span>
          <span data-testid="unit-task">{c?.task?.task_id ?? '없음'}</span>
        </div>
      </div>
      <div className="panel-section" data-testid="unit-work" style={{ display: 'grid', gap: 8 }}>
        <CameraView site={site} cellId={cellId} name={name} onDraw={sendDrag} drawPending={pending?.kind === 'drag'} />
        <div className="hint" data-testid="unit-hint">
          {pending
            ? '서버 응답을 기다리는 중…'
            : state === 'editing' && c?.snap?.ok === false && c.snap.task_id === c.task?.task_id
              ? '수렴 실패: 그린 선이 용접선에서 멀다. 빨간 점선 가까이 다시 그린다'
              : (HINT[state] ?? '')}
        </div>
        <div className="controls">
          {controls.map((b) => (
            <button key={b.id} className={CLASS[b.id]} data-testid={`btn-${b.id}`} disabled={!b.enabled} onClick={() => send(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section" style={{ display: 'grid', gap: 6 }}>
        <div className="kv">
          <span>진행률</span>
          <span data-testid="unit-progress">{Math.round(progress * 100)}%</span>
        </div>
        <div className="meter">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="kv">
          <span>신뢰도</span>
          <span data-testid="unit-confidence">{c?.proposal ? `${Math.round((c.proposal.confidence ?? 0) * 100)}%` : '-'}</span>
          <span>추론 지연</span>
          <span>{c?.metrics ? `${Math.round(c.metrics.latency_ms)} ms` : '-'}</span>
          <span>외란</span>
          <span>{c?.metrics ? `${Math.round(c.metrics.disturbance * 100)}%` : '-'}</span>
        </div>
      </div>
    </div>
  );
}
