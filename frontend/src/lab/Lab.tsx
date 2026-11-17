import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AgXToneMapping, SRGBColorSpace } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { TwinScene } from '../scene/TwinScene';
import { listSites, loadSiteConfig } from '../scene/site-configs';
import { useTwinStore } from '../store/twin-store';
import { VirtualClock } from './clock';
import { bindDebugApi, installDebugApi, markFailed, markReady } from './debug-api';
import { FixturePlayer, type FixtureLine } from './fixture';
import { loadFixture } from './fixture-files';
import { parseLabParams, type LabParams } from './params';
import { StatsCollector } from './stats';

installDebugApi();

/** ready로 치기 전에 그릴 프레임 수. 첫 프레임은 셰이더 컴파일 때문에 불안정하다. */
const READY_AFTER_FRAMES = 3;

interface Loaded {
  params: LabParams;
  site: string;
  preset: string;
  config: SiteConfig;
  lines: FixtureLine[];
}

async function load(search: string): Promise<Loaded> {
  const params = parseLabParams(search);
  const site = params.site ?? listSites()[0];
  if (!site) throw new Error('site-config가 하나도 없다');
  const [config, lines] = await Promise.all([loadSiteConfig(site), loadFixture(params.fixture)]);
  const preset = params.preset ?? config.presets[0].id;
  if (!config.presets.some((p) => p.id === preset)) {
    throw new Error(`프리셋 없음: ${preset} (있는 것: ${config.presets.map((p) => p.id).join(', ')})`);
  }
  return { params, site, preset, config, lines };
}

/** 트윈 랩: 씬만 띄우는 개발용 화면. digital-twin/docs/harness.md "트윈 랩". */
export default function Lab() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(window.location.search).then(
      (l) => !cancelled && setLoaded(l),
      (e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[twin-lab] ${msg}`);
        setError(msg);
        markFailed(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div style={styles.message}>트윈 랩 오류: {error}</div>;
  if (!loaded) return <div style={styles.message}>로딩 중…</div>;
  return <LabView loaded={loaded} />;
}

function LabView({ loaded }: { loaded: Loaded }) {
  const { params, site, preset, config, lines } = loaded;
  const hudRef = useRef<HTMLDivElement>(null);

  const rig = useMemo(() => {
    const store = useTwinStore.getState();
    store.reset();
    const clock = new VirtualClock(params.t, params.freeze);
    const player = new FixturePlayer(lines, store);
    player.seek(params.t);
    const stats = new StatsCollector();
    return { clock, player, stats };
  }, [params, lines]);

  useEffect(() => {
    bindDebugApi({ site, fixture: params.fixture, ...rig });
  }, [rig, site, params.fixture]);

  const high = params.quality === 'high';
  return (
    <div style={styles.root}>
      <Canvas
        dpr={high ? [1, 2] : [1, 1.5]}
        gl={{ antialias: high }}
        camera={{ fov: 45, near: 0.05, far: 500 }}
        onCreated={({ gl }) => {
          gl.toneMapping = AgXToneMapping;
          gl.outputColorSpace = SRGBColorSpace;
        }}
      >
        <Suspense fallback={null}>
          <TwinScene config={config} preset={preset} />
          <LabProbe {...rig} hudRef={hudRef} label={`${site} · ${params.fixture} · ${preset} · ${params.quality}`} />
        </Suspense>
      </Canvas>
      {params.hud && <div ref={hudRef} style={styles.hud} />}
    </div>
  );
}

interface ProbeProps {
  clock: VirtualClock;
  player: FixturePlayer;
  stats: StatsCollector;
  hudRef: RefObject<HTMLDivElement | null>;
  label: string;
}

/** 매 프레임: 가상 시계 진행 → 픽스처 반영 → 통계 수집 → HUD. Suspense 안에 있어 로딩이 끝난 뒤에만 돈다. */
function LabProbe({ clock, player, stats, hudRef, label }: ProbeProps) {
  const frames = useRef(0);
  useFrame(({ gl }, delta) => {
    clock.advance(delta * 1000);
    player.seek(clock.t);
    const { render, memory } = gl.info;
    stats.push(delta * 1000, {
      calls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
    });
    frames.current += 1;
    if (frames.current === READY_AFTER_FRAMES) markReady();
    if (hudRef.current) {
      hudRef.current.textContent = `${label} · t=${Math.round(clock.t)}ms${clock.frozen ? ' (정지)' : ''}`;
    }
  });
  return null;
}

const styles = {
  root: { position: 'fixed', inset: 0 },
  hud: {
    position: 'absolute',
    top: 8,
    left: 8,
    padding: '4px 8px',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#1d2228',
    background: 'rgba(255,255,255,0.75)',
    borderRadius: 4,
    pointerEvents: 'none',
  },
  message: { padding: 24, font: '14px/1.5 system-ui, sans-serif' },
} satisfies Record<string, React.CSSProperties>;
