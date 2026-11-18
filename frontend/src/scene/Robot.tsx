import { Select } from '@react-three/postprocessing';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Color, LoadingManager, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type MeshPhongMaterial } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { suspend } from 'suspend-react';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { cellKey, useTwinStore } from '../store/twin-store';
import { COLORS, isStale } from './cell-view';
import { INTERP_DELAY_MS, sampleJoints } from './joints';
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

type ColoredMaterial = Material & { color: Color; userData: { baseColor?: Color } };

/**
 * URDF와 링크 메시를 모두 받은 뒤 풀린다. URDFLoader는 메시가 오기 전에 로봇을 돌려주므로
 * 그대로 복제하면 메시 없는 로봇이 된다. 전용 LoadingManager로 모든 항목이 끝나기를 기다린다.
 */
function loadUrdf(url: string): Promise<URDFRobot> {
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

/** 도장면 PBR 값. URDF는 색만 주므로 공통값을 쓴다 */
const ROBOT_METALNESS = 0.15;
const ROBOT_ROUGHNESS = 0.45;

/**
 * URDF 복제본. URDFLoader가 만드는 Phong 재질을 PBR(MeshStandard)로 바꾸고(spec 2절 재질),
 * 오프라인 회색 처리를 셀마다 따로 하려고 재질을 셀마다 새로 만든다. 그림자를 드리우고 받는다(RD-03).
 */
function cloneRobot(source: URDFRobot): URDFRobot {
  const robot = source.clone(true) as URDFRobot;
  robot.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const phong = o.material as MeshPhongMaterial;
    const m = new MeshStandardMaterial({
      color: phong.color,
      metalness: ROBOT_METALNESS,
      roughness: ROBOT_ROUGHNESS,
    }) as unknown as ColoredMaterial;
    m.userData.baseColor = m.color.clone();
    o.material = m;
    o.geometry = smooth(o.geometry);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return robot;
}

function setDimmed(robot: URDFRobot, dimmed: boolean) {
  robot.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as ColoredMaterial;
    const base = m.userData.baseColor;
    if (base) m.color.copy(base).lerp(DIM, dimmed ? DIM_MIX : 0);
  });
  robot.userData.dimmed = dimmed;
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
      {stale && (
        <DomLabel position={[0, 0, 1.75]} testId={staleTestId(site, cellId)} variant="badge" content={STALE_CONTENT} />
      )}
    </group>
  );
}

const STALE_CONTENT = { text: '⏸ 멈춤 · 데이터 끊김' };
