import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CommandPayloads, SiteConfig } from '../contracts/messages.gen';
import { useBus } from '../app/bus-context';
import { CameraView } from './CameraView';
import { HINT, controlsFor, type ControlId } from './controls';
import { cellVisualState } from '../scene/cell-view';
import { jobName, showsProgress, uiState } from './ui-state';
import { useSelection } from '../scene/selection';
import { cellKey, useTwinStore } from '../store/twin-store';

/**
 * 사이드 패널(UI-01, UI-02). 로봇을 고르지 않았으면 로봇 목록, 고르면 그 로봇의 영상·작업·메트릭.
 * 작업 버튼은 서버 상태로만 활성화하고(UI-04), 명령을 보낸 뒤에는 서버 응답(상태 변화나 거부 알람)이 올 때까지 기다린다.
 */
export function Panel({ config }: { config: SiteConfig }) {
  const selected = useSelection((s) => s.selected);
  const cell = selected?.site === config.site ? config.cells.find((c) => c.id === selected.cell) : undefined;
  return cell ? <UnitPanel config={config} cellId={cell.id} name={cell.name} /> : <RobotList config={config} />;
}

/** 로봇을 고르지 않았을 때: 로봇 카드 목록. 하단 독에도 같은 로봇 버튼이 늘 있다 */
function RobotList({ config }: { config: SiteConfig }) {
  const select = useSelection((s) => s.select);
  const states = useTwinStore(useShallow((s) => config.cells.map((c) => cellVisualState(s.cells[cellKey(config.site, c.id)]))));
  const jobs = useTwinStore(useShallow((s) => config.cells.map((c) => s.cells[cellKey(config.site, c.id)]?.proposal?.surface ?? null)));
  return (
    <div className="panel-list" data-testid="robot-list">
      <div className="panel-list-head">
        <div className="panel-h1">로봇 {config.cells.length}대</div>
        <div className="panel-sub">로봇을 고르면 카메라 영상과 제안 경로가 뜬다</div>
      </div>
      <div className="panel-scroll">
        {config.cells.map((c, i) => {
          const st = uiState(states[i]);
          return (
            <button
              key={c.id}
              className="robot-card"
              data-testid={`robot-card-${c.id}`}
              data-state={states[i]}
              onClick={() => select({ site: config.site, cell: c.id, kind: 'robot', id: c.id })}
            >
              <span className="dot dot-lg" style={{ background: st.dot }} />
              <span className="robot-card-text">
                <span className="robot-card-name">{c.name}</span>
                <span className="panel-sub">{jobName(config, jobs[i])}</span>
              </span>
              <span className="robot-card-state">{st.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 명령을 보낸 뒤 응답을 기다리는 최대 시간. 넘으면 버튼을 다시 연다(서버가 응답하지 않은 것) */
const PENDING_TIMEOUT_MS = 5000;

function UnitPanel({ config, cellId, name }: { config: SiteConfig; cellId: string; name: string }) {
  const site = config.site;
  const bus = useBus();
  const select = useSelection((s) => s.select);
  const c = useTwinStore((s) => s.cells[cellKey(site, cellId)]);
  const state = cellVisualState(c);
  const st = uiState(state);
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
  const all = controlsFor(state, !!pending, connected);
  const stop = all.find((b) => b.id === 'estop');
  const controls = all.filter((b) => b.id !== 'estop');
  // 주 동작(파랑)은 승인·합격. 재개는 어두운 버튼, 나머지는 흰 버튼(디자인 v3)
  const CLASS: Record<ControlId, string> = {
    edit: 'btn btn-secondary',
    approve: 'btn btn-primary btn-wide',
    'confirm-rework': 'btn btn-secondary',
    'confirm-ok': 'btn btn-primary btn-wide',
    resume: 'btn btn-dark btn-wide',
    estop: 'btn btn-stop',
  };
  const progressShown = showsProgress(state);
  const confidence = c?.proposal ? Math.round((c.proposal.confidence ?? 0) * 100) : null;
  const hint = !connected
    ? '서버와 연결이 끊겼다'
    : pending
      ? '서버 응답을 기다리는 중…'
      : state === 'editing' && c?.snap?.ok === false && c.snap.task_id === c.task?.task_id
        ? '수렴 실패: 그린 선이 용접선에서 멀다. 빨간 점선 가까이 다시 그린다'
        : (HINT[state] ?? '');
  return (
    <div className="unit" data-testid="unit-panel" data-cell={cellId} data-state={state} data-pending={pending ? '1' : '0'}>
      <div className="unit-head">
        <button className="btn btn-secondary btn-square" onClick={() => select(null)} aria-label="로봇 목록으로">
          ←
        </button>
        <div className="unit-title">
          <div className="panel-h1 ellipsis">{name}</div>
          <div className="panel-sub ellipsis">{jobName(config, c?.proposal?.surface)}</div>
        </div>
        {stop && (
          <button className={CLASS.estop} data-testid="btn-estop" disabled={!stop.enabled} onClick={() => send('estop')}>
            {stop.label}
          </button>
        )}
      </div>

      <div className="panel-scroll" data-testid="unit-work">
        <div className="unit-hero">
          <div className="hero-num" data-testid={progressShown ? 'unit-progress' : 'unit-hero'}>
            {progressShown ? Math.round(progress * 100) : (confidence ?? '–')}
            <span className="hero-unit">%</span>
          </div>
          <div className="hero-side">
            <div className="hero-row">
              <span className="hero-label">{progressShown ? '진행률' : 'AI 신뢰도'}</span>
              <span className="state-badge" data-testid="unit-state" style={{ background: st.dot }}>
                {st.label}
              </span>
            </div>
            <div className="meter">
              <div style={{ width: `${(progressShown ? progress : 0) * 100}%` }} />
            </div>
            <div className="panel-sub">
              작업 <span data-testid="unit-task">{c?.task?.task_id ?? '없음'}</span>
            </div>
          </div>
        </div>

        <CameraView site={site} cellId={cellId} name={name} onDraw={sendDrag} drawPending={pending?.kind === 'drag'} />

        <div className="tiles">
          <div className="tile">
            <div className="tile-label">신뢰도</div>
            <div className="tile-value" data-testid="unit-confidence">
              {confidence ?? '–'}
              <span className="tile-unit">%</span>
            </div>
          </div>
          <div className="tile" data-testid="unit-live">
            <div className="tile-label">추론 지연</div>
            <div className="tile-value">
              {c?.metrics ? Math.round(c.metrics.latency_ms) : '–'}
              <span className="tile-unit">ms</span>
            </div>
          </div>
          <div className="tile" data-testid="unit-live">
            <div className="tile-label">외란 강도</div>
            <div className="tile-value">
              {c?.metrics ? Math.round(c.metrics.disturbance * 100) : '–'}
              <span className="tile-unit">%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="unit-foot">
        <div className="hint-bar" data-testid="unit-hint">
          <span className="dot dot-ring" style={{ background: st.dot }} />
          <span>{hint}</span>
        </div>
        {controls.length > 0 && (
          <div className="controls">
            {controls.map((b) => (
              <button key={b.id} className={CLASS[b.id]} data-testid={`btn-${b.id}`} disabled={!b.enabled} onClick={() => send(b.id)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
