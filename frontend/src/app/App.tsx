import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SRGBColorSpace } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { AlarmCard, useAlarmRows } from '../alarms/AlarmList';
import { connectBus, defaultBrokerUrl, type Bus, type BusStats } from '../bus/mqtt-bus';
import { overlayDebug } from '../panel/CameraView';
import { Panel } from '../panel/Panel';
import { uiState } from '../panel/ui-state';
import { cellVisualState } from '../scene/cell-view';
import { detectQuality } from '../scene/quality';
import { useSelection } from '../scene/selection';
import { defaultSite, loadSiteConfig } from '../scene/site-configs';
import { TwinScene } from '../scene/TwinScene';
import { LoadingOverlay } from '../scene/ui/LoadingOverlay';
import { SceneErrorBoundary } from '../scene/ui/SceneErrorBoundary';
import { cellKey, useTwinStore } from '../store/twin-store';
import { BusContext, MediaContext } from './bus-context';
import type { AppDebugApi } from './debug';
import { operatorId } from './operator';
// 글꼴: 쓰는 굵기(400·500)만 로컬 파일로 묶는다. 현장 장비가 인터넷에 못 붙어도 된다(ADR 0006)
import 'pretendard/dist/web/static/Pretendard-Regular.css';
import 'pretendard/dist/web/static/Pretendard-Medium.css';
import './app.css';

const HEARTBEAT_MS = 1000;

/**
 * 관제 웹앱(frontend/docs/spec.md). 3D 트윈 + 사이드 패널 + 알람 목록 + 고정 긴급정지.
 *   /?site=ship-block&broker=ws://localhost:9001&media=http://localhost:8090
 * 상태는 서버(지금은 tools/mock-server.mjs)가 MQTT로 보낸다. 웹은 명령만 보내고, 화면은 받은 상태로만 바뀐다.
 */
export function App() {
  const q = new URLSearchParams(window.location.search);
  const site = q.get('site') ?? defaultSite();
  const brokerUrl = q.get('broker') ?? defaultBrokerUrl();
  const media = q.get('media') ?? '';
  const operator = useMemo(operatorId, []);
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BusStats | null>(null);
  const [bus, setBus] = useState<Bus | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [tier] = useState(detectQuality);

  useEffect(() => {
    if (!site) return setError('site-config가 하나도 없다');
    loadSiteConfig(site).then(
      (c) => {
        setConfig(c);
        setPreset(c.presets[0].id);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [site]);

  // bus: 한 틱 늦게 붙는다(StrictMode 즉시 재마운트에서 웹소켓을 열자마자 닫지 않게)
  useEffect(() => {
    if (!site) return;
    useTwinStore.getState().reset();
    let b: Bus | null = null;
    const sent: ReturnType<AppDebugApi['sent']> = [];
    const timer = setTimeout(() => {
      const raw = connectBus({
        url: brokerUrl,
        site,
        operator,
        apply: (topic, payload, at) => useTwinStore.getState().apply(topic, payload, at),
        now: () => performance.now(), // 씬의 기본 시계(TwinTimeContext)와 같다
        onChange: setStats,
      });
      b = {
        ...raw,
        command: (cell, suffix, body) => {
          const cmd_id = raw.command(cell, suffix, body);
          sent.push({ cmd_id, suffix, cell });
          return cmd_id;
        },
      };
      setBus(b);
    }, 0);
    let beating = true; // 검사용 스위치(__app.setHeartbeat)
    const beat = setInterval(() => beating && b?.heartbeat(), HEARTBEAT_MS);
    window.__app = {
      site: () => site,
      operator: () => operator,
      bus: () => b?.stats() ?? null,
      selection: () => useSelection.getState().selected,
      cells: () => structuredClone(useTwinStore.getState().cells),
      sent: () => [...sent],
      overlay: (cell) => overlayDebug.get(cell) ?? null,
      setHeartbeat: (on) => {
        beating = on;
      },
    };
    return () => {
      clearTimeout(timer);
      clearInterval(beat);
      setBus(null);
      void b?.close();
    };
  }, [site, brokerUrl, operator]);

  if (error) return <div className="app-boot">관제 화면 오류: {error}</div>;
  if (!config || !preset) return <div className="app-boot">로딩 중…</div>;
  return (
    <BusContext.Provider value={bus}>
      <MediaContext.Provider value={media}>
        <Shell config={config} stats={stats} brokerUrl={brokerUrl} operator={operator} preset={preset} onPreset={setPreset} bus={bus} tier={tier} />
      </MediaContext.Provider>
    </BusContext.Provider>
  );
}

const PANEL_W = 440;
const PANEL_MIN = 320;
const clampPanel = (w: number, total: number) => Math.round(Math.max(PANEL_MIN, Math.min(w, total * 0.62)));

/** 화면 틀(디자인 v3): 상태 줄 / 사이드 패널 · 손잡이 · 3D 트윈 / 하단 독 */
function Shell(props: {
  config: SiteConfig;
  stats: BusStats | null;
  brokerUrl: string;
  operator: string;
  preset: string;
  onPreset: (id: string) => void;
  bus: Bus | null;
  tier: ReturnType<typeof detectQuality>;
}) {
  const { config, stats, brokerUrl, operator, preset, onPreset, bus, tier } = props;
  const state = stats?.state ?? 'connecting';
  const lost = state === 'reconnecting' || state === 'closed';
  // 브로커는 붙었는데 로봇 서버가 모두 오프라인(유언 status=offline)
  const serverDown = useTwinStore((s) => config.cells.every((c) => s.cells[cellKey(config.site, c.id)]?.online === false));
  const selected = useSelection((s) => s.selected);
  const selectedCell = selected?.site === config.site ? selected.cell : null;
  const rows = useAlarmRows(config);
  const [showAlarms, setShowAlarms] = useState(true);
  const [panelW, setPanelW] = useState(PANEL_W);
  const [dragging, setDragging] = useState(false);
  const main = useRef<HTMLElement>(null);

  // 로봇을 고르면 그 로봇 프리셋으로, 풀면 첫 프리셋(전경)으로
  useEffect(() => {
    const id = selectedCell ?? config.presets[0].id;
    if (config.presets.some((p) => p.id === id)) onPreset(id);
  }, [selectedCell, config, onPreset]);

  // 치명 알람이 새로 오면 닫아 둔 알람 카드를 다시 연다
  const critical = rows.filter((r) => r.a.severity === 'critical').length;
  const lastCritical = useRef(critical);
  useEffect(() => {
    if (critical > lastCritical.current) setShowAlarms(true);
    lastCritical.current = critical;
  }, [critical]);

  const total = () => main.current?.getBoundingClientRect().width ?? window.innerWidth;
  const grip = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging || !main.current) return;
      const r = main.current.getBoundingClientRect();
      setPanelW(clampPanel(e.clientX - r.left - 14, r.width));
    },
    onPointerUp: () => setDragging(false),
    onPointerCancel: () => setDragging(false),
    onDoubleClick: () => setPanelW((w) => (w > 460 ? 360 : clampPanel(total() * 0.5, total()))),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') setPanelW((w) => clampPanel(w - 20, total()));
      if (e.key === 'ArrowRight') setPanelW((w) => clampPanel(w + 20, total()));
    },
  };

  return (
    <div className="app" data-testid="app" style={{ '--panel-w': `${panelW}px` } as React.CSSProperties}>
      <Header config={config} stats={stats} brokerUrl={brokerUrl} operator={operator} />
      <main className="app-main" ref={main}>
        <aside className="app-panel" data-testid="app-panel">
          <Panel config={config} />
        </aside>
        <div
          className="app-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="패널 크기 조정"
          aria-valuenow={panelW}
          aria-valuemin={PANEL_MIN}
          tabIndex={0}
          title="끌어서 크기 조정 · 두 번 눌러 전환"
          data-dragging={dragging ? '1' : '0'}
          {...grip}
        >
          <div />
        </div>
        <section className="app-scene" data-testid="app-scene" data-lost={lost ? '1' : '0'}>
          <div className="scene-canvas">
            <SceneErrorBoundary>
              <Canvas
                dpr={[1, 2]}
                gl={{ antialias: false }}
                shadows="percentage"
                camera={{ fov: 45, near: 0.05, far: 500 }}
                onCreated={({ gl }) => {
                  gl.outputColorSpace = SRGBColorSpace;
                }}
                onPointerMissed={() => useSelection.getState().select(null)}
              >
                <Suspense fallback={null}>
                  <TwinScene config={config} preset={preset} tier={tier} />
                </Suspense>
              </Canvas>
            </SceneErrorBoundary>
          </div>
          <LoadingOverlay />
          <div className="presets" role="group" aria-label="카메라 프리셋">
            {config.presets.map((p) => (
              <button key={p.id} className="preset" aria-pressed={p.id === preset} title={p.name} onClick={() => onPreset(p.id)}>
                {config.cells.find((c) => c.id === p.id)?.name ?? p.name}
              </button>
            ))}
          </div>
          {showAlarms && <AlarmCard config={config} rows={rows} onClose={() => setShowAlarms(false)} />}
          {lost ? (
            <div className="bus-banner" data-testid="bus-banner" data-kind="broker">
              브로커와 끊겼다 · 다시 붙으면 마지막 상태로 복구한다
            </div>
          ) : (
            serverDown && (
              <div className="bus-banner" data-testid="bus-banner" data-kind="server">
                로봇 서버와 끊겼다 · 로봇 상태를 받지 못한다
              </div>
            )
          )}
        </section>
      </main>
      <Dock config={config} bus={bus} selectedCell={selectedCell} alarms={rows} onAlarms={() => setShowAlarms((v) => !v)} />
    </div>
  );
}

const LABEL: Record<BusStats['state'], string> = { connecting: '연결 중', connected: '연결됨', reconnecting: '다시 연결 중', closed: '끊김' };
const CONN_DOT: Record<BusStats['state'], string> = { connecting: '#8E8E8E', connected: '#171A20', reconnecting: '#C2261C', closed: '#C2261C' };

function useClock() {
  const fmt = () => new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const [clock, setClock] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setClock(fmt()), 10_000);
    return () => clearInterval(t);
  }, []);
  return clock;
}

/** 상태 줄: 사이트 이름, 시계, 브로커 연결, 운영자 */
function Header(props: { config: SiteConfig; stats: BusStats | null; brokerUrl: string; operator: string }) {
  const { config, stats, brokerUrl, operator } = props;
  const state = stats?.state ?? 'connecting';
  const clock = useClock();
  const info = `${brokerUrl} · 받은 메시지 ${stats?.received ?? 0}${stats?.dropped ? ` · 버린 메시지 ${stats.dropped}` : ''}`;
  return (
    <header className="app-header">
      <span className="logo" aria-hidden="true">
        <span />
      </span>
      <span className="site-name">{config.name}</span>
      <span style={{ flex: 1 }} />
      <span className="clock">{clock}</span>
      <span className="conn" data-testid="bus-state" data-state={state} title={info}>
        <span className="dot" style={{ background: CONN_DOT[state] }} />
        {LABEL[state]}
      </span>
      <span className="operator" data-testid="bus-info" title={info}>
        운영자 {operator}
      </span>
    </header>
  );
}

/** 하단 독: 로봇 버튼(고르기), 알람 열기, 전체 재개, 전체 긴급정지. 정지는 언제나 보인다 */
function Dock(props: { config: SiteConfig; bus: Bus | null; selectedCell: string | null; alarms: { a: { severity: string } }[]; onAlarms: () => void }) {
  const { config, bus, selectedCell, alarms, onAlarms } = props;
  const select = useSelection((s) => s.select);
  const states = useTwinStore(useShallow((s) => config.cells.map((c) => cellVisualState(s.cells[cellKey(config.site, c.id)]))));
  const anyStopped = states.includes('estopped');
  const critical = alarms.some((r) => r.a.severity === 'critical');
  return (
    <footer className="app-dock" data-testid="app-dock">
      <div className="dock-robots">
        {config.cells.map((c, i) => {
          const st = uiState(states[i]);
          const on = c.id === selectedCell;
          return (
            <button
              key={c.id}
              className="dock-robot"
              aria-pressed={on}
              data-testid={`robot-row-${c.id}`}
              data-state={states[i]}
              onClick={() => select({ site: config.site, cell: c.id, kind: 'robot', id: c.id })}
            >
              <span className="dot dot-ring" style={{ background: st.dot }} />
              <span className="dock-robot-text">
                <span className="dock-robot-name">{c.name}</span>
                <span className="dock-robot-state">{st.label}</span>
              </span>
            </button>
          );
        })}
        <button className="dock-alarms" data-testid="btn-alarms" onClick={onAlarms}>
          알람
          <span className="count" style={{ background: critical ? '#C2261C' : '#171A20' }}>
            {alarms.length}
          </span>
        </button>
      </div>
      {anyStopped && (
        <button className="btn btn-dark dock-btn" data-testid="btn-resume-all" disabled={!bus} onClick={() => bus?.command(null, 'cmd/resume', {})}>
          전체 재개
        </button>
      )}
      <button className="btn btn-estop dock-btn" data-testid="btn-estop-all" disabled={!bus} onClick={() => bus?.command(null, 'cmd/estop', { reason: '전체 긴급정지 버튼' })}>
        전체 긴급정지
      </button>
    </footer>
  );
}
