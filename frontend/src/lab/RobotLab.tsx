import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Selection } from '@react-three/postprocessing';
import { Suspense, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import { Box3, Mesh, SRGBColorSpace, Vector3, type Object3D } from 'three';
import { suspend } from 'suspend-react';
import type { URDFRobot } from 'urdf-loader';
import { Effects } from '../scene/Effects';
import { SITE_TO_SCENE_ROTATION_X, siteToScene, type V3 } from '../scene/frame';
import { LightRig } from '../scene/Lighting';
import { QUALITY, type QualityTier } from '../scene/quality';
import { cloneRobot, loadUrdf } from '../scene/Robot';
import { LoadingOverlay } from '../scene/ui/LoadingOverlay';
import { SceneErrorBoundary } from '../scene/ui/SceneErrorBoundary';
import type { JointMeta, Mount } from './robot-lab-api';

/**
 * 로봇 랩(/lab/robot): 로봇 하나만 바닥이나 벽에 붙여 보고 관절을 손으로 움직인다. 사이트·픽스처 없이 URDF만 본다.
 *   /lab/robot?robot=spider-welder&mount=floor|wall&quality=high|low&panel=0&j=arm_2:30,fl_knee:-20
 * window.__robotLab으로 상태를 조회한다(harness/e2e/robot.spec.ts). 좌표는 사이트 좌표계(Z-up, m).
 */

const ROBOTS = Object.keys(import.meta.glob('../../../digital-twin/assets/robot/*/robot.urdf', { query: '?url', import: 'default' }))
  .map((p) => p.split('/').at(-2)!)
  .sort();

const WALL_CENTER_Z_M = 1.1;
const READY_AFTER_FRAMES = 3;
const STAGE_BOUNDS = { min: [-2.5, -2.5, 0] as V3, max: [2.5, 2.5, 2.8] as V3 };

interface Params {
  robot: string;
  mount: Mount;
  quality: QualityTier;
  panel: boolean;
  joints: Record<string, number>;
}

function parseParams(search: string): Params {
  const q = new URLSearchParams(search);
  const robot = q.get('robot') ?? (ROBOTS.includes('spider-welder') ? 'spider-welder' : ROBOTS[0]);
  if (!ROBOTS.includes(robot)) throw new Error(`로봇 없음: ${robot} (있는 것: ${ROBOTS.join(', ')})`);
  const mount = (q.get('mount') ?? 'floor') as Mount;
  if (mount !== 'floor' && mount !== 'wall') throw new Error(`mount는 floor 또는 wall이다: ${mount}`);
  const quality = (q.get('quality') ?? 'high') as QualityTier;
  const joints: Record<string, number> = {};
  for (const part of (q.get('j') ?? '').split(',').filter(Boolean)) {
    const [name, v] = part.split(':');
    if (!name || !Number.isFinite(Number(v))) throw new Error(`j 형식은 이름:각도(deg),…다: ${part}`);
    joints[name] = Number(v);
  }
  return { robot, mount, quality, panel: q.get('panel') !== '0', joints };
}


// ---------- 디버그 API ----------

const sceneToSite = (v: Vector3): V3 => [v.x, -v.z, v.y];

let readyResolve: (() => void) | null = null;
let readyReject: ((e: Error) => void) | null = null;
const readyPromise = new Promise<void>((res, rej) => {
  readyResolve = res;
  readyReject = rej;
});
readyPromise.catch(() => undefined);
let frameWaiters: { n: number; resolve: () => void }[] = [];
let live: { robot: URDFRobot; params: Params; setJoints: (j: Record<string, number>) => void; setMount: (m: Mount) => void } | null =
  null;

const waitFrames = (n: number) => new Promise<void>((resolve) => frameWaiters.push({ n, resolve }));

function linkObject(name?: string): Object3D {
  if (!live) throw new Error('로봇이 아직 없다');
  if (!name) return live.robot;
  const o = live.robot.links[name];
  if (!o) throw new Error(`링크 없음: ${name}`);
  return o;
}

window.__robotLab = {
  ready: () => readyPromise,
  state: () => {
    if (!live) throw new Error('로봇이 아직 없다');
    let meshes = 0;
    let triangles = 0;
    live.robot.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      meshes++;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { robot: live.params.robot, mount: live.params.mount, joints: { ...live.params.joints }, meta: jointMeta(live.robot), meshes, triangles };
  },
  setJoints: async (deg) => {
    if (!live) throw new Error('로봇이 아직 없다');
    live.setJoints(deg);
    await waitFrames(3);
  },
  setMount: async (mount) => {
    if (!live) throw new Error('로봇이 아직 없다');
    live.setMount(mount);
    await waitFrames(3);
  },
  box: (link, own) => {
    const o = linkObject(link);
    o.updateWorldMatrix(true, true);
    const b = new Box3();
    if (own) {
      // URDF 링크의 자식 중 visual(isURDFVisual)만. 자식 관절 아래 링크는 뺀다
      for (const c of o.children) if ((c as { isURDFVisual?: boolean }).isURDFVisual) b.expandByObject(c);
    } else b.setFromObject(o);
    const a = sceneToSite(b.min);
    const c = sceneToSite(b.max);
    return { min: [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2])], max: [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])] };
  },
  frame: (link) => {
    const o = linkObject(link);
    o.updateWorldMatrix(true, false);
    const origin = o.getWorldPosition(new Vector3());
    const z = new Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    return { origin: sceneToSite(origin), z: sceneToSite(z) };
  },
};

function jointMeta(robot: URDFRobot): JointMeta[] {
  return Object.values(robot.joints)
    .filter((j) => j.jointType !== 'fixed')
    .map((j) => ({
      name: j.name,
      lower: Math.round((Number(j.limit.lower) * 180) / Math.PI),
      upper: Math.round((Number(j.limit.upper) * 180) / Math.PI),
    }));
}

// ---------- 화면 ----------

export default function RobotLab() {
  const [params, setParams] = useState<Params | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<JointMeta[]>([]);

  useEffect(() => {
    try {
      setParams(parseParams(window.location.search));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[robot-lab] ${msg}`);
      readyReject?.(new Error(msg));
      setError(msg);
    }
  }, []);

  if (error) return <div style={styles.message}>로봇 랩 오류: {error}</div>;
  if (!params) return <div style={styles.message}>로딩 중…</div>;
  const quality = QUALITY[params.quality];
  const setJoints = (j: Record<string, number>) => setParams((p) => p && { ...p, joints: { ...p.joints, ...j } });

  return (
    <div style={styles.root}>
      <SceneErrorBoundary
        onError={(e) => {
          console.error(`[robot-lab] ${e instanceof Error ? e.message : String(e)}`);
          readyReject?.(e instanceof Error ? e : new Error(String(e)));
        }}
      >
        <Canvas
          key={`${params.robot}:${params.quality}`}
          dpr={quality.dpr}
          gl={{ antialias: false }}
          shadows="percentage"
          camera={{ fov: 40, near: 0.02, far: 200 }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = SRGBColorSpace;
          }}
        >
          <Selection>
            <LightRig bounds={STAGE_BOUNDS} quality={quality} />
            <Stage mount={params.mount} />
            <Suspense fallback={null}>
              <RobotStage params={params} onMeta={setMeta} setJoints={setJoints} setMount={(mount) => setParams((p) => p && { ...p, mount })} />
            </Suspense>
            <Effects quality={quality} tier={params.quality} />
          </Selection>
        </Canvas>
      </SceneErrorBoundary>
      <LoadingOverlay />
      {params.panel && (
        <JointPanel
          params={params}
          meta={meta}
          onJoint={(name, v) => setJoints({ [name]: v })}
          onReset={() => setParams((p) => p && { ...p, joints: {} })}
          onMount={(mount) => setParams((p) => p && { ...p, mount })}
        />
      )}
    </div>
  );
}

/** 바닥과(벽 모드면) 세운 강판 벽. 벽 면은 사이트 y = 0, 로봇은 -y 쪽에 붙는다 */
function Stage({ mount }: { mount: Mount }) {
  return (
    <group rotation-x={SITE_TO_SCENE_ROTATION_X}>
      <mesh position={[0, 0, -0.01]} receiveShadow>
        <boxGeometry args={[40, 40, 0.02]} />
        <meshStandardMaterial color="#5a5b58" roughness={0.92} />
      </mesh>
      {mount === 'wall' && (
        <mesh position={[0, 0.015, 1.4]} receiveShadow castShadow>
          <boxGeometry args={[4, 0.03, 2.8]} />
          <meshStandardMaterial color="#7d4b3a" metalness={0.3} roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

interface StageProps {
  params: Params;
  onMeta: (m: JointMeta[]) => void;
  setJoints: (j: Record<string, number>) => void;
  setMount: (m: Mount) => void;
}

function RobotStage({ params, onMeta, setJoints, setMount }: StageProps) {
  const url = `/robots/${params.robot}/robot.urdf`;
  const source = suspend(() => loadUrdf(url), ['urdf', url]);
  const robot = useMemo(() => cloneRobot(source), [source]);
  const camera = useThree((s) => s.camera);

  // 0° 자세의 크기로 놓을 자리를 정한다(관절을 움직여도 몸통이 튀지 않게 한 번만)
  const zeroBox = useMemo(() => {
    for (const j of Object.values(robot.joints)) if (j.jointType !== 'fixed') j.setJointValue(0);
    robot.updateMatrixWorld(true);
    return new Box3().setFromObject(robot);
  }, [robot]);

  const placement = useMemo(() => {
    const min = zeroBox.min;
    const size = zeroBox.getSize(new Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (params.mount === 'floor') {
      return { position: [0, 0, -min.z] as V3, rotationX: 0, center: [0, 0, size.z / 2] as V3, eye: [1.15, -1.2, 0.72] as V3, extent };
    }
    // 벽: 로봇 +Z가 사이트 -Y를 보게 X축으로 90° 돌린다. 발판(로봇 최저 z)이 벽 면 y = 0에 닿는다
    return { position: [0, min.z, WALL_CENTER_Z_M] as V3, rotationX: Math.PI / 2, center: [0, -size.z / 2, WALL_CENTER_Z_M] as V3, eye: [0.7, -1.6, 0.35] as V3, extent };
  }, [zeroBox, params.mount]);

  useLayoutEffect(() => {
    for (const j of Object.values(robot.joints)) if (j.jointType !== 'fixed') j.setJointValue(0);
    for (const [name, v] of Object.entries(params.joints)) {
      const j = robot.joints[name];
      if (!j) console.warn(`[robot-lab] URDF에 없는 관절 ${name}`);
      else j.setJointValue((v * Math.PI) / 180);
    }
  }, [robot, params.joints]);

  useEffect(() => {
    onMeta(jointMeta(robot));
    live = { robot, params, setJoints, setMount };
  });

  const target = useMemo(() => siteToScene(placement.center), [placement]);
  useLayoutEffect(() => {
    const d = placement.extent * (params.mount === "floor" ? 1.05 : 1.25);
    const e = placement.eye;
    camera.position.set(...siteToScene([placement.center[0] + e[0] * d, placement.center[1] + e[1] * d, placement.center[2] + e[2] * d]));
    camera.lookAt(...target);
  }, [camera, placement, target, params.mount]);

  return (
    <>
      <OrbitControls target={target} makeDefault minDistance={0.3} maxDistance={8} maxPolarAngle={(85 * Math.PI) / 180} />
      <group rotation-x={SITE_TO_SCENE_ROTATION_X}>
        <group position={placement.position} rotation-x={placement.rotationX}>
          <primitive object={robot} />
        </group>
      </group>
      <Probe />
    </>
  );
}

function Probe() {
  const [frames, setFrames] = useState(0);
  useFrame(() => {
    if (frames < READY_AFTER_FRAMES) setFrames((f) => f + 1);
    if (frames + 1 === READY_AFTER_FRAMES) readyResolve?.();
    const due = frameWaiters.filter((w) => --w.n <= 0);
    frameWaiters = frameWaiters.filter((w) => w.n > 0);
    due.forEach((w) => w.resolve());
  });
  return null;
}

const GROUPS: [string, string][] = [
  ['arm_', '팔'],
  ['fl_', '앞 왼다리'],
  ['fr_', '앞 오른다리'],
  ['rl_', '뒤 왼다리'],
  ['rr_', '뒤 오른다리'],
];

function JointPanel({
  params,
  meta,
  onJoint,
  onReset,
  onMount,
}: {
  params: Params;
  meta: JointMeta[];
  onJoint: (name: string, v: number) => void;
  onReset: () => void;
  onMount: (m: Mount) => void;
}) {
  const groups = GROUPS.map(([prefix, label]) => [label, meta.filter((j) => j.name.startsWith(prefix))] as const).filter(([, js]) => js.length);
  const rest = meta.filter((j) => !GROUPS.some(([p]) => j.name.startsWith(p)));
  if (rest.length) groups.push(['관절', rest] as const);
  return (
    <div style={styles.panel}>
      <div style={styles.row}>
        <select
          value={params.robot}
          onChange={(e) => {
            const q = new URLSearchParams(window.location.search);
            q.set('robot', e.target.value);
            q.delete('j');
            window.location.search = q.toString();
          }}
        >
          {ROBOTS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button onClick={() => onMount(params.mount === 'floor' ? 'wall' : 'floor')}>{params.mount === 'floor' ? '벽에 붙이기' : '바닥에 두기'}</button>
        <button onClick={onReset}>0° 자세</button>
      </div>
      {groups.map(([label, js]) => (
        <fieldset key={label} style={styles.group}>
          <legend>{label}</legend>
          {js.map((j) => {
            const v = params.joints[j.name] ?? 0;
            return (
              <label key={j.name} style={styles.slider}>
                <span style={styles.name}>{j.name}</span>
                <input type="range" min={j.lower} max={j.upper} step={1} value={v} onChange={(e) => onJoint(j.name, Number(e.target.value))} />
                <span style={styles.value}>{v}°</span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { position: 'fixed', inset: 0, background: '#cfd4da' },
  message: { padding: 24, font: '14px system-ui' },
  panel: {
    position: 'absolute',
    top: 8,
    right: 8,
    bottom: 8,
    width: 300,
    overflowY: 'auto',
    background: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
    padding: 10,
    font: '12px system-ui',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  row: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  group: { border: '1px solid #d0d4d8', borderRadius: 6, margin: '0 0 8px', padding: '4px 8px' },
  slider: { display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 4 },
  name: { fontFamily: 'ui-monospace, monospace', fontSize: 11 },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
};
