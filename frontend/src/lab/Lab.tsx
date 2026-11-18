import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { SRGBColorSpace } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { TwinScene } from '../scene/TwinScene';
import { listSites, loadSiteConfig } from '../scene/site-configs';
import { QUALITY, detectQuality } from '../scene/quality';
import { useSelection } from '../scene/selection';
import { TwinTimeContext } from '../scene/time';
import { LoadingOverlay } from '../scene/ui/LoadingOverlay';
import { SceneErrorBoundary } from '../scene/ui/SceneErrorBoundary';
import { useTwinStore } from '../store/twin-store';
import { VirtualClock } from './clock';
import { bindDebugApi, bindLabControls, bindThree, installDebugApi, markFailed, markMounted, onFrame } from './debug-api';
import { FixturePlayer, type FixtureLine } from './fixture';
import { listFixtures, loadFixture } from './fixture-files';
import { parseLabParams, type LabParams, type QualityTier } from './params';
import { StatsCollector } from './stats';

installDebugApi();

/** ready로 치기 전에 그릴 프레임 수. 첫 프레임은 셰이더 컴파일 때문에 불안정하다. */
const READY_AFTER_FRAMES = 3;

interface Loaded {
  params: LabParams;
  site: string;
  /** 쓰는 픽스처 이름(인자가 없으면 `{site}-idle`) */
  fixture: string;
  config: SiteConfig;
  lines: FixtureLine[];
}

function checkPreset(config: SiteConfig, preset: string) {
  if (!config.presets.some((p) => p.id === preset)) {
    throw new Error(`프리셋 없음: ${preset} (있는 것: ${config.presets.map((p) => p.id).join(', ')})`);
  }
}

async function load(search: string): Promise<Loaded> {
  const params = parseLabParams(search);
  const site = params.site ?? listSites()[0];
  if (!site) throw new Error('site-config가 하나도 없다');
  const fixture = params.fixture ?? (listFixtures().includes(`${site}-idle`) ? `${site}-idle` : listFixtures()[0]);
  if (!fixture) throw new Error('픽스처가 하나도 없다');
  const [config, lines] = await Promise.all([loadSiteConfig(site), loadFixture(fixture)]);
  checkPreset(config, params.preset ?? config.presets[0].id);
  return { params, site, fixture, config, lines };
}

function fail(e: unknown) {
  console.error(`[twin-lab] ${e instanceof Error ? e.message : String(e)}`);
  markFailed(e);
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
        fail(e);
        setError(e instanceof Error ? e.message : String(e));
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

interface ViewState {
  site: string;
  config: SiteConfig;
  preset: string;
  quality: QualityTier;
  /** 바뀌면 Canvas를 다시 만든다(사이트·품질 전환) */
  mount: number;
}

function LabView({ loaded }: { loaded: Loaded }) {
  const { params, lines } = loaded;
  const hudRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(() => ({
    site: loaded.site,
    config: loaded.config,
    preset: params.preset ?? loaded.config.presets[0].id,
    quality: params.quality ?? detectQuality(),
    mount: 0,
  }));

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
    bindDebugApi({ site: view.site, fixture: loaded.fixture, ...rig });
  }, [rig, view.site, loaded.fixture]);

  const setPreset = useCallback((preset: string) => {
    setView((v) => {
      checkPreset(v.config, preset);
      return { ...v, preset };
    });
  }, []);
  const setSite = useCallback(async (site: string) => {
    const config = await loadSiteConfig(site);
    useSelection.getState().select(null);
    setView((v) => ({ ...v, site, config, preset: config.presets[0].id, mount: v.mount + 1 }));
  }, []);
  const setQuality = useCallback((quality: QualityTier) => {
    setView((v) => ({ ...v, quality, mount: v.mount + 1 }));
  }, []);
  useEffect(() => bindLabControls({ setPreset, setSite, setQuality }), [setPreset, setSite, setQuality]);

  const now = useMemo(() => () => rig.clock.t, [rig]);
  const quality = QUALITY[view.quality];
  const label = `${view.site} · ${loaded.fixture} · ${view.preset} · ${view.quality}`;
  return (
    <div style={styles.root}>
      <SceneErrorBoundary onError={fail}>
        <Canvas
          key={view.mount}
          dpr={quality.dpr}
          gl={{ antialias: false }}
          shadows="percentage"
          camera={{ fov: 45, near: 0.05, far: 500 }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = SRGBColorSpace;
          }}
          onPointerMissed={() => useSelection.getState().select(null)}
        >
          <TwinTimeContext.Provider value={now}>
            <Suspense fallback={null}>
              <TwinScene config={view.config} preset={view.preset} tier={view.quality} />
              <LabProbe {...rig} mount={view.mount} hudRef={hudRef} label={label} />
            </Suspense>
          </TwinTimeContext.Provider>
        </Canvas>
      </SceneErrorBoundary>
      <LoadingOverlay />
      {params.hud && <div ref={hudRef} style={styles.hud} />}
    </div>
  );
}

interface ProbeProps {
  clock: VirtualClock;
  player: FixturePlayer;
  stats: StatsCollector;
  mount: number;
  hudRef: RefObject<HTMLDivElement | null>;
  label: string;
}

/**
 * 매 프레임: 가상 시계 진행 → 픽스처 반영 → 통계 수집 → HUD.
 * Suspense 안에 있어 로딩이 끝난 뒤에만 돈다. 우선순위 -1: 씬의 useFrame(로봇 등)보다 먼저 돈다.
 */
function LabProbe({ clock, player, stats, mount, hudRef, label }: ProbeProps) {
  const frames = useRef(0);
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  useEffect(() => bindThree(get), [get]);
  // 후처리는 한 프레임에 렌더를 여러 번 부른다(그림자·장면·SSAO·외곽선·톤매핑).
  // autoReset이면 마지막 패스만 남으므로 끄고, 프레임 시작에 직전 프레임 합계를 읽은 뒤 지운다.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
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
    gl.info.reset();
    frames.current += 1;
    onFrame();
    if (frames.current === READY_AFTER_FRAMES) markMounted(mount);
    if (hudRef.current) {
      hudRef.current.textContent = `${label} · t=${Math.round(clock.t)}ms${clock.frozen ? ' (정지)' : ''}`;
    }
  }, -1);
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
