import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SRGBColorSpace } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { AlarmList } from '../alarms/AlarmList';
import { connectBus, defaultBrokerUrl, type Bus, type BusStats } from '../bus/mqtt-bus';
import { overlayDebug } from '../panel/CameraView';
import { Panel } from '../panel/Panel';
import { cellVisualState } from '../scene/cell-view';
import { detectQuality } from '../scene/quality';
import { useSelection } from '../scene/selection';
import { listSites, loadSiteConfig } from '../scene/site-configs';
import { TwinScene } from '../scene/TwinScene';
import { LoadingOverlay } from '../scene/ui/LoadingOverlay';
import { SceneErrorBoundary } from '../scene/ui/SceneErrorBoundary';
import { cellKey, useTwinStore } from '../store/twin-store';
import { BusContext, MediaContext } from './bus-context';
import type { AppDebugApi } from './debug';
import { operatorId } from './operator';
import './app.css';

const HEARTBEAT_MS = 1000;

/**
 * 관제 웹앱(frontend/docs/spec.md). 3D 트윈 + 사이드 패널 + 알람 목록 + 고정 긴급정지.
 *   /?site=ship-block&broker=ws://localhost:9001&media=http://localhost:8090
 * 상태는 서버(지금은 tools/mock-server.mjs)가 MQTT로 보낸다. 웹은 명령만 보내고, 화면은 받은 상태로만 바뀐다.
 */
export function App() {
  const q = new URLSearchParams(window.location.search);
  const site = q.get('site') ?? listSites()[0];
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
    const beat = setInterval(() => b?.heartbeat(), HEARTBEAT_MS);
    window.__app = {
      site: () => site,
      operator: () => operator,
      bus: () => b?.stats() ?? null,
      selection: () => useSelection.getState().selected,
      cells: () => structuredClone(useTwinStore.getState().cells),
      sent: () => [...sent],
      overlay: (cell) => overlayDebug.get(cell) ?? null,
    };
    return () => {
      clearTimeout(timer);
      clearInterval(beat);
      setBus(null);
      void b?.close();
    };
  }, [site, brokerUrl, operator]);

  if (error) return <div style={{ padding: 24 }}>관제 화면 오류: {error}</div>;
  if (!config || !preset) return <div style={{ padding: 24 }}>로딩 중…</div>;
  return (
    <BusContext.Provider value={bus}>
      <MediaContext.Provider value={media}>
        <div className="app" data-testid="app">
          <Header config={config} stats={stats} brokerUrl={brokerUrl} operator={operator} preset={preset} onPreset={setPreset} bus={bus} />
          <div className="app-scene" data-testid="app-scene">
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
            <LoadingOverlay />
          </div>
          <aside className="app-panel" data-testid="app-panel">
            <Panel config={config} />
          </aside>
          <section className="app-alarms" data-testid="app-alarms">
            <AlarmList config={config} />
          </section>
        </div>
      </MediaContext.Provider>
    </BusContext.Provider>
  );
}

const LABEL: Record<BusStats['state'], string> = { connecting: '연결 중', connected: '연결됨', reconnecting: '다시 연결 중', closed: '닫힘' };
const BADGE: Record<BusStats['state'], string> = { connecting: '#8a929b', connected: '#2fa76a', reconnecting: '#d9822b', closed: '#8a929b' };

function Header(props: {
  config: SiteConfig;
  stats: BusStats | null;
  brokerUrl: string;
  operator: string;
  preset: string;
  onPreset: (id: string) => void;
  bus: Bus | null;
}) {
  const { config, stats, brokerUrl, operator, preset, onPreset, bus } = props;
  const state = stats?.state ?? 'connecting';
  const anyStopped = useTwinStore(useShallow((s) => config.cells.some((c) => cellVisualState(s.cells[cellKey(config.site, c.id)]) === 'estopped')));
  return (
    <header className="app-header">
      <strong>{config.name}</strong>
      <span data-testid="bus-state" data-state={state} className="badge" style={{ background: BADGE[state] }}>
        {LABEL[state]}
      </span>
      <span className="muted" data-testid="bus-info">
        {brokerUrl} · 받은 메시지 {stats?.received ?? 0}
        {stats?.dropped ? ` · 버린 메시지 ${stats.dropped}` : ''} · 운영자 {operator}
      </span>
      <span style={{ flex: 1 }} />
      <select value={preset} onChange={(e) => onPreset(e.target.value)} aria-label="카메라 프리셋" style={{ minHeight: 32 }}>
        {config.presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {anyStopped && (
        <button className="btn btn-warn" data-testid="btn-resume-all" disabled={!bus} onClick={() => bus?.command(null, 'cmd/resume', {})}>
          전체 재개
        </button>
      )}
      <button className="btn btn-estop" data-testid="btn-estop-all" disabled={!bus} onClick={() => bus?.command(null, 'cmd/estop', { reason: '전체 긴급정지 버튼' })}>
        전체 긴급정지
      </button>
    </header>
  );
}
