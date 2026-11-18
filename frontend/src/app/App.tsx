import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useState, type CSSProperties } from 'react';
import { SRGBColorSpace } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { connectBus, defaultBrokerUrl, type BusStats } from '../bus/mqtt-bus';
import { detectQuality } from '../scene/quality';
import { useSelection } from '../scene/selection';
import { listSites, loadSiteConfig } from '../scene/site-configs';
import { TwinScene } from '../scene/TwinScene';
import { LoadingOverlay } from '../scene/ui/LoadingOverlay';
import { SceneErrorBoundary } from '../scene/ui/SceneErrorBoundary';
import { useTwinStore } from '../store/twin-store';

/**
 * 관제 웹앱(M5): 브로커에 붙은 실시간 디지털 트윈. 상태는 서버(지금은 tools/play.mjs)가 MQTT로 보낸다.
 *   /?site=ship-block&broker=ws://localhost:9001
 * 사이드 패널(작업 승인·수정)은 서버 단계에서 이 화면 옆에 붙인다. 씬과 store는 트윈 랩과 같다.
 */
export function App() {
  const q = new URLSearchParams(window.location.search);
  const site = q.get('site') ?? listSites()[0];
  const broker = q.get('broker') ?? defaultBrokerUrl();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bus, setBus] = useState<BusStats | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [tier] = useState(detectQuality);
  const selected = useSelection((s) => s.selected);

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

  useEffect(() => {
    if (!site) return;
    useTwinStore.getState().reset();
    let close: (() => Promise<void>) | null = null;
    // 한 틱 늦게 붙는다(StrictMode 즉시 재마운트에서 웹소켓을 열자마자 닫지 않게)
    const timer = setTimeout(() => {
      const b = connectBus({
        url: broker,
        site,
        apply: (topic, payload, at) => useTwinStore.getState().apply(topic, payload, at),
        now: () => performance.now(), // 씬의 기본 시계(TwinTimeContext)와 같다
        onChange: setBus,
      });
      close = b.close;
    }, 0);
    return () => {
      clearTimeout(timer);
      void close?.();
    };
  }, [site, broker]);

  if (error) return <div style={styles.message}>관제 화면 오류: {error}</div>;
  if (!config || !preset) return <div style={styles.message}>로딩 중…</div>;
  const state = bus?.state ?? 'connecting';
  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <strong>{config.name}</strong>
        <span data-testid="bus-state" data-state={state} style={{ ...styles.badge, background: BADGE[state] }}>
          {LABEL[state]}
        </span>
        <span style={styles.muted}>
          {broker} · 받은 메시지 {bus?.received ?? 0}
          {bus?.dropped ? ` · 버린 메시지 ${bus.dropped}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {config.presets.map((p) => (
          <button key={p.id} onClick={() => setPreset(p.id)} style={p.id === preset ? styles.on : styles.off}>
            {p.name}
          </button>
        ))}
      </header>
      <div style={styles.scene}>
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
        {selected && (
          <div data-testid="selection" style={styles.selection}>
            선택: {selected.cell} · {selected.kind === 'robot' ? '로봇(카메라가 따라간다)' : `알람 ${selected.id}`}
          </div>
        )}
      </div>
    </div>
  );
}

const LABEL: Record<BusStats['state'], string> = { connecting: '연결 중', connected: '연결됨', reconnecting: '다시 연결 중', closed: '닫힘' };
const BADGE: Record<BusStats['state'], string> = { connecting: '#8a929b', connected: '#2fa76a', reconnecting: '#d9822b', closed: '#8a929b' };

const styles = {
  root: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', font: '13px/1.4 system-ui, sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#1d2228', color: '#eef1f4' },
  badge: { padding: '2px 8px', borderRadius: 10, color: 'white', fontSize: 12 },
  muted: { color: '#a9b2bc', fontSize: 12 },
  on: { background: '#3b82f6', color: 'white', border: 0, borderRadius: 4, padding: '4px 8px' },
  off: { background: '#2c333b', color: '#d6dbe0', border: 0, borderRadius: 4, padding: '4px 8px' },
  scene: { position: 'relative', flex: 1 },
  selection: { position: 'absolute', left: 12, bottom: 12, padding: '6px 10px', background: 'rgba(255,255,255,0.9)', borderRadius: 6 },
  message: { padding: 24, font: '14px/1.5 system-ui, sans-serif' },
} satisfies Record<string, CSSProperties>;
