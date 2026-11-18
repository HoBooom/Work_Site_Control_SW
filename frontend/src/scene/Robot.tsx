import { Select } from '@react-three/postprocessing';
import { createPortal, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  RingGeometry,
  Vector3,
  type Group,
  type MeshPhongMaterial,
  type Object3D,
  type PointLight,
} from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { suspend } from 'suspend-react';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { cellKey, useTwinStore } from '../store/twin-store';
import { COLORS, isStale } from './cell-view';
import { INTERP_DELAY_MS, sampleJoints } from './joints';
import { sampleContacts } from './pose';
import { objectName, staleTestId } from './names';
import { CLICK_MAX_DRAG_PX, isSame, useSelection } from './selection';
import { useTwinNow } from './time';
import { DomLabel } from './ui/DomLabel';

interface Props {
  site: string;
  cellId: string;
  url: string;
}

const DIM = new Color(COLORS.dim);
/** 오프라인일 때 원래 색에서 회색으로 섞는 비율(DY-08) */
const DIM_MIX = 0.85;


/**
 * URDF와 링크 메시를 모두 받은 뒤 풀린다. URDFLoader는 메시가 오기 전에 로봇을 돌려주므로
 * 그대로 복제하면 메시 없는 로봇이 된다. 전용 LoadingManager로 모든 항목이 끝나기를 기다린다.
 */
export function loadUrdf(url: string): Promise<URDFRobot> {
  return new Promise((resolve, reject) => {
    const manager = new LoadingManager();
    let robot: URDFRobot | null = null;
    let failed: string | null = null;
    manager.onError = (u) => {
      failed = u;
    };
    manager.onLoad = () => {
      if (failed) reject(new Error(`로봇 메시를 불러오지 못했다: ${failed}`));
      else if (robot) resolve(robot);
      else reject(new Error(`URDF를 불러오지 못했다: ${url}`));
    };
    new URDFLoader(manager).load(
      url,
      (r) => {
        robot = r;
      },
      undefined,
      (e) => reject(e instanceof Error ? e : new Error(`URDF를 불러오지 못했다: ${url}`)),
    );
  });
}

/** STL은 면 법선만 있어 원기둥이 각져 보인다. 이 각도 아래로 꺾인 면끼리 법선을 잇는다(파이프라인 glb.py와 같은 값) */
const CREASE_RAD = (35 * Math.PI) / 180;
const creased = new WeakMap<BufferGeometry, BufferGeometry>();

function smooth(g: BufferGeometry): BufferGeometry {
  let out = creased.get(g);
  if (!out) {
    out = toCreasedNormals(g, CREASE_RAD);
    creased.set(g, out);
  }
  return out;
}

/** 도장면 PBR 값. URDF는 색만 주므로 아래 표에 없는 재질 이름은 이 값을 쓴다 */
const ROBOT_METALNESS = 0.15;
const ROBOT_ROUGHNESS = 0.45;

/**
 * URDF 재질 이름별 PBR 값(digital-twin/assets/gen/spider.py COLORS와 이름이 같다).
 * 대역 6축 로봇(body, dark, steel, copper)은 표에 없어 위 공통값을 쓴다.
 */
export const ROBOT_PBR: Record<string, { metalness: number; roughness: number }> = {
  aluminum: { metalness: 0.85, roughness: 0.32 },
  carbon: { metalness: 0.1, roughness: 0.28 },
  graphite: { metalness: 0.55, roughness: 0.42 },
  cobot: { metalness: 0.0, roughness: 0.45 },
  brass: { metalness: 0.9, roughness: 0.3 },
  lens: { metalness: 0.0, roughness: 0.08 },
};

/** 로봇 하나(URDF 원본)에서 한 번 만드는 것: 재질 팔레트 텍스처, 링크별로 합친 형상 */
interface Prepared {
  /** 재질 순서대로 원래 색, 오프라인 색(linear) */
  colors: Color[];
  dimmed: Color[];
  map: DataTexture;
  dimMap: DataTexture;
  /** G = 거칠기, B = 금속성(three roughnessMap·metalnessMap 규약) */
  orm: DataTexture;
  /** 링크 이름 → 그 링크의 모든 visual을 링크 좌표계로 합친 형상 */
  links: Map<string, BufferGeometry>;
}

const prepared = new WeakMap<URDFRobot, Prepared>();

function paletteTexture(texels: [number, number, number][]): DataTexture {
  const data = new Float32Array(texels.length * 4);
  texels.forEach(([r, g, b], i) => data.set([r, g, b, 1], i * 4));
  const t = new DataTexture(data, texels.length, 1, RGBAFormat, FloatType);
  // 텍셀 가운데만 읽는다: 꼭짓점 UV가 재질마다 상수라 색·값이 원래 재질과 똑같다
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const isVisual = (o: Object3D) => !!(o as { isURDFVisual?: boolean }).isURDFVisual;

/**
 * 링크 안의 재질별 메시를 하나로 합친다(드로우 콜). 링크는 따로 움직이므로 링크 하나 = 메시 하나가 최소다.
 * 재질 차이는 1×N 팔레트 텍스처(색, 거칠기·금속성)로 옮기고 꼭짓점 UV가 자기 재질의 텍셀을 가리킨다.
 */
function prepare(source: URDFRobot): Prepared {
  const cached = prepared.get(source);
  if (cached) return cached;
  const keys: string[] = [];
  const colors: Color[] = [];
  const pbr: { metalness: number; roughness: number }[] = [];
  const keyOf = (m: MeshPhongMaterial) => m.name || `#${m.color.getHexString()}`;
  source.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshPhongMaterial;
    if (keys.includes(keyOf(m))) return;
    keys.push(keyOf(m));
    colors.push(m.color.clone());
    pbr.push(ROBOT_PBR[m.name] ?? { metalness: ROBOT_METALNESS, roughness: ROBOT_ROUGHNESS });
  });
  const dimmed = colors.map((c) => c.clone().lerp(DIM, DIM_MIX));
  source.updateWorldMatrix(true, true);
  const links = new Map<string, BufferGeometry>();
  for (const [name, link] of Object.entries(source.links)) {
    const toLink = new Matrix4().copy(link.matrixWorld).invert();
    const parts: BufferGeometry[] = [];
    for (const v of link.children.filter(isVisual)) {
      v.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const src = smooth(o.geometry);
        const g = new BufferGeometry();
        g.setAttribute('position', src.getAttribute('position').clone());
        g.setAttribute('normal', src.getAttribute('normal').clone());
        g.applyMatrix4(new Matrix4().multiplyMatrices(toLink, o.matrixWorld));
        const u = (keys.indexOf(keyOf(o.material as MeshPhongMaterial)) + 0.5) / keys.length;
        const n = g.getAttribute('position').count;
        const uv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) uv.set([u, 0.5], i * 2);
        g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
        parts.push(g);
      });
    }
    if (parts.length) links.set(name, mergeGeometries(parts));
  }
  const out: Prepared = {
    colors,
    dimmed,
    map: paletteTexture(colors.map((c) => [c.r, c.g, c.b])),
    dimMap: paletteTexture(dimmed.map((c) => [c.r, c.g, c.b])),
    orm: paletteTexture(pbr.map((p) => [1, p.roughness, p.metalness])),
    links,
  };
  prepared.set(source, out);
  return out;
}

/**
 * URDF 복제본. 링크마다 합친 메시 하나(prepare)를 PBR 재질 하나로 그린다(spec 2절 재질).
 * 재질은 셀마다 새로 만들어 오프라인 회색 처리를 따로 한다. 그림자를 드리우고 받는다(RD-03).
 * 링크의 첫 visual을 남겨 합친 메시를 담는다(디버그 API·로봇 랩이 visual로 링크 형상을 찾는다).
 */
export function cloneRobot(source: URDFRobot): URDFRobot {
  const p = prepare(source);
  const robot = source.clone(true) as URDFRobot;
  const material = new MeshStandardMaterial({ map: p.map, roughnessMap: p.orm, metalnessMap: p.orm, roughness: 1, metalness: 1 });
  material.userData = { prepared: p, palette: p.colors };
  for (const [name, link] of Object.entries(robot.links)) {
    const visuals = link.children.filter(isVisual);
    const geometry = p.links.get(name);
    if (!visuals.length || !geometry) continue;
    const [holder, ...rest] = visuals;
    rest.forEach((v) => link.remove(v));
    holder.clear();
    holder.position.set(0, 0, 0);
    holder.quaternion.identity();
    holder.scale.set(1, 1, 1);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    holder.add(mesh);
  }
  robot.userData.material = material;
  return robot;
}

/** DY-08: 오프라인이면 팔레트를 회색 쪽으로 섞은 것으로 바꾼다. 디버그 API는 material.userData.palette로 지금 색을 본다 */
function setDimmed(robot: URDFRobot, dimmed: boolean) {
  const m = robot.userData.material as MeshStandardMaterial | undefined;
  if (m) {
    const p = m.userData.prepared as Prepared;
    m.map = dimmed ? p.dimMap : p.map;
    m.userData.palette = dimmed ? p.dimmed : p.colors;
  }
  robot.userData.dimmed = dimmed;
}

/** DY-12 발 접촉 표시 색: 자석 켬(붙음) / 끔(든 발) */
const CONTACT_ON = new Color('#2fbf71');
const CONTACT_OFF = new Color('#f59e0b');

/** 발 링크 형상(발판) 바닥에 그 둘레보다 조금 큰 고리를 붙인다. 링크 좌표계: 발판 바닥이 형상 최저 z */
function makeContactRing(link: Object3D, name: string): Mesh | null {
  const mesh = link.children.find(isVisual)?.children[0];
  if (!(mesh instanceof Mesh)) return null;
  const g = mesh.geometry as BufferGeometry;
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const r = 0.5 * Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 1.15;
  const ring = new Mesh(
    new RingGeometry(r * 0.8, r, 40),
    new MeshBasicMaterial({ color: CONTACT_ON, toneMapped: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  ring.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z + 0.002);
  ring.name = `contact:${name}`;
  ring.userData = { contact: name, on: true };
  link.add(ring);
  return ring;
}

/** contacts(발 링크 → 붙음)대로 고리를 보이고 색을 바꾼다. null이면(고정 로봇, 오프라인) 모두 숨긴다 */
function showContacts(robot: URDFRobot, contacts: Record<string, boolean> | null, warn: (name: string) => void) {
  const rings = (robot.userData.contactRings ??= {}) as Record<string, Mesh>;
  for (const r of Object.values(rings)) r.visible = false;
  if (!contacts) return;
  for (const [name, on] of Object.entries(contacts)) {
    const link = robot.links[name];
    if (!link) {
      warn(name);
      continue;
    }
    const ring = (rings[name] ??= makeContactRing(link, name)!);
    if (!ring) continue;
    ring.visible = true;
    if (ring.userData.on !== on) {
      ring.userData.on = on;
      (ring.material as MeshBasicMaterial).color.copy(on ? CONTACT_ON : CONTACT_OFF);
    }
  }
}

// ---------- RD-06 용접 아크 ----------

/** 공구 링크 이름 규약: 토치가 달린 링크는 `torch`(spider.py, make_robot.py) */
const TORCH_LINK = 'torch';
/** 아크 코어 색(linear HDR). bloom 문턱(Effects ARC_BLOOM_THRESHOLD)보다 몇 배 밝다 */
const ARC_CORE = new Color(6, 7.5, 10);
const ARC_LIGHT = new Color('#a9c8ff');
const ARC_LIGHT_INTENSITY = 1.6;
/** 깜빡임 한 칸(ms). 가상 시계로 계산해 freeze=1이면 멈춘다(결정성) */
const ARC_FLICKER_MS = 45;

/** 토치 노즐 끝: 토치 링크 형상에서 링크 원점에서 가장 먼 꼭짓점 */
function torchTip(robot: URDFRobot): { link: Object3D; local: Vector3 } | null {
  const link = robot.links[TORCH_LINK];
  const mesh = link?.children.find(isVisual)?.children[0];
  if (!link || !(mesh instanceof Mesh)) return null;
  const pos = (mesh.geometry as BufferGeometry).getAttribute('position');
  const v = new Vector3();
  const best = new Vector3();
  let max = -1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.lengthSq() > max) {
      max = v.lengthSq();
      best.copy(v);
    }
  }
  return { link, local: best };
}

/** 정수 → [0, 1) 결정적 잡음 */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * RD-06: 작업 상태가 실행 중(running)이고 온라인일 때만 토치 끝에 아크(밝은 코어 + 점광원)를 켠다.
 * 점광원은 늘 장면에 두고 세기만 0으로 내린다(빛 수가 바뀌면 모든 재질 셰이더를 다시 컴파일해 프레임이 멈춘다).
 */
function WeldArc({ robot, site, cellId }: { robot: URDFRobot; site: string; cellId: string }) {
  const tip = useMemo(() => torchTip(robot), [robot]);
  const now = useTwinNow();
  const key = cellKey(site, cellId);
  const core = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  useFrame(() => {
    const c = useTwinStore.getState().cells[key];
    const on = c?.task?.state === 'running' && c.online !== false;
    const f = 0.7 + 0.3 * hash(Math.floor(now() / ARC_FLICKER_MS));
    if (core.current) {
      core.current.visible = on;
      core.current.scale.setScalar(0.8 + 0.4 * f);
    }
    if (light.current) light.current.intensity = on ? ARC_LIGHT_INTENSITY * f : 0;
  });
  if (!tip) return null;
  return createPortal(
    <group position={tip.local}>
      <group ref={core} name={objectName('arc', site, cellId)} visible={false}>
        <mesh userData={{ overlay: true }}>
          <sphereGeometry args={[0.009, 12, 8]} />
          <meshBasicMaterial color={ARC_CORE} toneMapped={false} />
        </mesh>
      </group>
      <pointLight ref={light} color={ARC_LIGHT} intensity={0} distance={2.5} decay={2} />
    </group>,
    tip.link,
  );
}

/**
 * DY-01: robot/state 샘플을 보간해 매 프레임 관절에 건다. 셀마다 URDF를 복제해 쓴다.
 * DY-08: 오프라인이면 회색. DY-09: 샘플이 끊기면 마지막 자세를 두고 "멈춤" 표시. IX-02: 누르면 선택.
 */
export function Robot({ site, cellId, url }: Props) {
  // URDFLoader는 three Loader 타입이 아니라 useLoader 대신 suspend로 캐시한다
  const source = suspend(() => loadUrdf(url), ['urdf', url]);
  const robot = useMemo(() => cloneRobot(source), [source]);
  const now = useTwinNow();
  const key = cellKey(site, cellId);
  const warned = useRef(new Set<string>());
  const [stale, setStale] = useState(false);
  const selected = useSelection((s) => s.selected);
  const select = useSelection((s) => s.select);
  const me = { site, cell: cellId, kind: 'robot' as const, id: cellId };

  useFrame(() => {
    const c = useTwinStore.getState().cells[key];
    const offline = c?.online === false;
    if (robot.userData.dimmed !== offline) setDimmed(robot, offline);
    const samples = c?.jointSamples;
    const s = isStale(samples, now());
    if (s !== stale) setStale(s);
    if (!samples?.length) return;
    // DY-12 발 접촉: 관절과 같은 지연 시각의 값. 오프라인이면 알 수 없으므로 숨긴다
    showContacts(robot, offline ? null : sampleContacts(samples, now() - INTERP_DELAY_MS), (name) => {
      if (warned.current.has(`contact:${name}`)) return;
      warned.current.add(`contact:${name}`);
      console.warn(`[twin] ${key}: URDF에 없는 발 링크 ${name}`);
    });
    const joints = sampleJoints(samples, now() - INTERP_DELAY_MS);
    if (!joints) return;
    for (const [name, degValue] of Object.entries(joints)) {
      const joint = robot.joints[name];
      if (!joint) {
        if (!warned.current.has(name)) {
          warned.current.add(name);
          console.warn(`[twin] ${key}: URDF에 없는 관절 ${name}`);
        }
        continue;
      }
      joint.setJointValue((degValue * Math.PI) / 180);
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta <= CLICK_MAX_DRAG_PX) select(me);
  };

  return (
    <group name={objectName('robot', site, cellId)} userData={{ stale }} onClick={onClick}>
      <Select enabled={isSame(selected, me)}>
        <primitive object={robot} />
      </Select>
      <WeldArc robot={robot} site={site} cellId={cellId} />
      {stale && (
        <DomLabel position={[0, 0, 1.75]} testId={staleTestId(site, cellId)} variant="badge" content={STALE_CONTENT} />
      )}
    </group>
  );
}

const STALE_CONTENT = { text: '⏸ 멈춤 · 데이터 끊김' };
