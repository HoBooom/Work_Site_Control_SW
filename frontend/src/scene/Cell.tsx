import { Line } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import { Vector3, type Group } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { cellKey, useTwinStore } from '../store/twin-store';
import { SEVERITY_COLOR, STATE_STYLE, cellVisualState, seamView, sortedAlarms } from './cell-view';
import { deg, type V3 } from './frame';
import { INTERP_DELAY_MS } from './joints';
import { alarmName, labelTestId, objectName } from './names';
import type { CellConfig } from './plate';
import { sampleBase } from './pose';
import { Robot } from './Robot';
import type { SurfaceConfig } from './surface';
import { useTwinNow } from './time';
import { DomLabel } from './ui/DomLabel';
import { CLICK_MAX_DRAG_PX, isSame, useSelection } from './selection';

const PLATE_THICKNESS_M = 0.02;
/** 용접선을 판 윗면에서 띄우는 높이(m). z-fighting 방지 */
const SEAM_LIFT_M = 0.0015;
/** 셀 좌표계 기준 상태 램프 기둥 위치(셀 안전선 +X+Y 모서리 안쪽, 작업판 뒤) */
const LAMP_POS: V3 = [2.2, 1.3, 0];
const LAMP_HEIGHT_M = 1.7;
/** 셀 좌표계 기준 알람 마커 쌓기 시작점(로봇 위) */
const ALARM_BASE: V3 = [0.25, 0, 1.8];
const ALARM_STEP_M = 0.28;
/** 이동 로봇: 로봇 좌표계 기준 상태 비콘(몸통 뒤 윗면), 라벨, 알람 마커 시작점. 벽에 붙으면 로봇 +Z(벽 법선) 쪽으로 뜬다 */
const BEACON_POS: V3 = [-0.16, 0, 0.075];
const MOBILE_LABEL_Z_M = 0.95;
const MOBILE_ALARM_BASE: V3 = [0, 0, 1.15];
const Z_AXIS = new Vector3(0, 0, 1);

interface Props {
  site: string;
  cell: CellConfig;
  /** site-config surfaces. 경로가 면을 가리키면 그 면 위에 용접선을 그린다 */
  surfaces?: SurfaceConfig[];
}

/**
 * 작업 단위 하나(= 로봇 1대, ADR 0003). 사이트 좌표계(Z-up) 안에 놓인다.
 * - 고정 로봇(작업판 있음): 셀 원점 → 작업판(+용접선), 램프 기둥과 라벨, 알람 마커. 로봇은 셀·로봇 자세에.
 * - 이동 로봇(작업판 없음): 로봇이 robot/state.base를 따라 움직이고, 상태 비콘·라벨·알람 마커가 로봇에 붙어 다닌다.
 *   용접선은 경로가 가리키는 면(surface) 위에 그린다.
 */
export function Cell({ site, cell, surfaces = [] }: Props) {
  const { plate, robot } = cell;
  const mobile = !plate;
  return (
    <>
      <group name={objectName('cell', site, cell.id)} position={cell.pose.position_m} rotation-z={deg(cell.pose.yaw_deg)}>
        {plate && (
          <group position={plate.pose.position_m} rotation-z={deg(plate.pose.yaw_deg)}>
            <Plate site={site} cellId={cell.id} sizeMm={plate.size_mm} />
            <Seam site={site} cellId={cell.id} />
          </group>
        )}
        {!mobile && <StatusLamp site={site} cell={cell} />}
        {!mobile && <AlarmMarkers site={site} cellId={cell.id} base={ALARM_BASE} />}
      </group>
      <RobotMount site={site} cell={cell}>
        {robot.urdf && <Robot site={site} cellId={cell.id} url={robot.urdf} />}
        {mobile && <StatusLamp site={site} cell={cell} beacon />}
        {mobile && <AlarmMarkers site={site} cellId={cell.id} base={MOBILE_ALARM_BASE} />}
      </RobotMount>
      {mobile && <SurfaceSeam site={site} cellId={cell.id} surfaces={surfaces} />}
    </>
  );
}

/** 셀·로봇 자세를 합친 로봇 기준점(사이트 좌표). 고정 로봇은 늘 여기, 이동 로봇은 base가 오기 전 대기 위치 */
function homePose(cell: CellConfig): { position: V3; yaw: number } {
  const [cx, cy, cz] = cell.pose.position_m;
  const [rx, ry, rz] = cell.robot.pose.position_m;
  const a = deg(cell.pose.yaw_deg);
  return {
    position: [cx + Math.cos(a) * rx - Math.sin(a) * ry, cy + Math.sin(a) * rx + Math.cos(a) * ry, cz + rz],
    yaw: a + deg(cell.robot.pose.yaw_deg),
  };
}

/** 로봇이 놓이는 그룹. robot/state.base가 있으면(이동 로봇) 매 프레임 보간한 몸통 자세로 옮긴다(관절과 같은 지연) */
function RobotMount({ site, cell, children }: { site: string; cell: CellConfig; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const now = useTwinNow();
  const key = cellKey(site, cell.id);
  const home = useMemo(() => homePose(cell), [cell]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const samples = useTwinStore.getState().cells[key]?.jointSamples;
    const b = samples ? sampleBase(samples, now() - INTERP_DELAY_MS) : null;
    if (b) {
      g.position.set(...b.position_m);
      g.quaternion.set(...b.orientation_xyzw);
    } else {
      g.position.set(...home.position);
      g.quaternion.setFromAxisAngle(Z_AXIS, home.yaw);
    }
  });
  return (
    <group ref={ref} position={home.position} rotation-z={home.yaw}>
      {children}
    </group>
  );
}

/** AS-03: 판 원점(모서리)이 그룹 원점, 윗면이 z=0 */
function Plate({ site, cellId, sizeMm }: { site: string; cellId: string; sizeMm: [number, number] }) {
  const [w, h] = [sizeMm[0] / 1000, sizeMm[1] / 1000];
  return (
    <group name={objectName('plate', site, cellId)}>
      <mesh position={[w / 2, h / 2, -PLATE_THICKNESS_M / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, PLATE_THICKNESS_M]} />
        <meshStandardMaterial color="#8e959c" metalness={0.5} roughness={0.45} />
      </mesh>
      {/* 원점 모서리 표식 */}
      <mesh position={[0.02, 0.02, 0.0005]}>
        <boxGeometry args={[0.04, 0.04, 0.001]} />
        <meshStandardMaterial color="#1f6feb" />
      </mesh>
    </group>
  );
}

/**
 * DY-03, DY-04, DY-06, DY-07: 경로(판 좌표 mm)를 판 위 선으로. 수렴 결과가 있으면 그것을 그린다.
 * 상태에 따라 실선·점선·완료/남은 구간 색이 바뀐다(cell-view.ts).
 */
function Seam({ site, cellId }: { site: string; cellId: string }) {
  const key = cellKey(site, cellId);
  const c = useTwinStore((s) => s.cells[key]);
  const path = c?.snap?.path ?? c?.proposal?.path ?? null;
  return <SeamLine site={site} cellId={cellId} path={path} />;
}

/**
 * 이동 로봇: 경로가 가리키는 면(surface) 위 용접선. 면 좌표계(원점 모서리, +Z = 로봇 쪽 법선) 그룹 안에 그린다.
 * 수렴 결과(snap)가 있으면 그 경로와 면을 쓴다.
 */
function SurfaceSeam({ site, cellId, surfaces }: { site: string; cellId: string; surfaces: SurfaceConfig[] }) {
  const key = cellKey(site, cellId);
  const c = useTwinStore((s) => s.cells[key]);
  const src = c?.snap ?? c?.proposal ?? null;
  const surface = src?.surface ? surfaces.find((x) => x.id === src.surface) : undefined;
  if (src?.surface && !surface) console.warn(`[twin] ${key}: site-config에 없는 surface ${src.surface}`);
  if (!surface || !src) return null;
  return (
    <group position={surface.pose.position_m} quaternion={surface.pose.orientation_xyzw}>
      <SeamLine site={site} cellId={cellId} path={src.path} />
    </group>
  );
}

/** 판·면 좌표(mm) 경로를 그 좌표계 그룹 안에 선으로. 상태별 모양은 cell-view.ts */
function SeamLine({ site, cellId, path }: { site: string; cellId: string; path: [number, number][] | null }) {
  const key = cellKey(site, cellId);
  const c = useTwinStore((s) => s.cells[key]);
  const points = useMemo(
    () => path?.map(([x, y]) => [x / 1000, y / 1000, SEAM_LIFT_M] as V3) ?? null,
    [path],
  );
  const view = seamView(c, points);
  if (!view || !points) return null;
  return (
    <group name={objectName('seam', site, cellId)} userData={{ platePoints: points, view }}>
      {view.done.length >= 2 && <Line points={view.done} color={view.doneColor} lineWidth={3} />}
      {view.todo.length >= 2 && (
        <Line
          points={view.todo}
          color={view.todoColor}
          lineWidth={3}
          dashed={view.dashed}
          dashSize={0.025}
          gapSize={0.015}
        />
      )}
    </group>
  );
}

/**
 * DY-04 셀 상태색 + IX-04 셀 라벨. 고정 로봇은 램프 기둥 위에, 이동 로봇(beacon)은 몸통 위 작은 비콘과 로봇 위 라벨.
 */
function StatusLamp({ site, cell, beacon = false }: { site: string; cell: CellConfig; beacon?: boolean }) {
  const key = cellKey(site, cell.id);
  const state = useTwinStore((s) => cellVisualState(s.cells[key]));
  const style = STATE_STYLE[state];
  const dataset = useMemo(() => ({ state }), [state]);
  if (beacon) {
    return (
      <group position={BEACON_POS}>
        <mesh name={objectName('lamp', site, cell.id)} position={[0, 0, 0.02]} rotation-x={Math.PI / 2} userData={{ state }}>
          <cylinderGeometry args={[0.024, 0.024, 0.04, 16]} />
          <meshStandardMaterial color={style.lamp} emissive={style.lamp} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        <DomLabel
          position={[-BEACON_POS[0], 0, MOBILE_LABEL_Z_M]}
          testId={labelTestId(site, cell.id)}
          dataset={dataset}
          content={{ dot: style.lamp, bold: cell.name, text: style.label }}
        />
      </group>
    );
  }
  return (
    <group position={LAMP_POS}>
      {/* three 원기둥은 Y축 방향. 사이트 좌표계(Z-up)에서 세우려고 X축으로 돌린다 */}
      <mesh position={[0, 0, LAMP_HEIGHT_M / 2]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.025, 0.025, LAMP_HEIGHT_M, 12]} />
        <meshStandardMaterial color="#2b2f33" roughness={0.6} />
      </mesh>
      <mesh
        name={objectName('lamp', site, cell.id)}
        position={[0, 0, LAMP_HEIGHT_M + 0.09]}
        rotation-x={Math.PI / 2}
        userData={{ state }}
      >
        <cylinderGeometry args={[0.07, 0.07, 0.18, 20]} />
        <meshStandardMaterial color={style.lamp} emissive={style.lamp} emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      <DomLabel
        position={[0, 0, LAMP_HEIGHT_M + 0.35]}
        testId={labelTestId(site, cell.id)}
        dataset={dataset}
        content={{ dot: style.lamp, bold: cell.name, text: style.label }}
      />
    </group>
  );
}

/** DY-05: 활성 알람마다 심각도 색 마커를 셀 위에 쌓는다. 누르면 선택(IX-02) */
function AlarmMarkers({ site, cellId, base }: { site: string; cellId: string; base: V3 }) {
  const key = cellKey(site, cellId);
  const alarms = useTwinStore(useShallow((s) => sortedAlarms(s.cells[key])));
  const selected = useSelection((s) => s.selected);
  const select = useSelection((s) => s.select);
  return (
    <>
      {alarms.map((a, i) => {
        const sel = { site, cell: cellId, kind: 'alarm' as const, id: a.alarm_id };
        const onClick = (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta <= CLICK_MAX_DRAG_PX) select(sel);
        };
        return (
          <Select key={a.alarm_id} enabled={isSame(selected, sel)}>
            <mesh
              name={alarmName(site, cellId, a.alarm_id)}
              position={[base[0], base[1], base[2] + i * ALARM_STEP_M]}
              userData={{ alarmId: a.alarm_id, severity: a.severity }}
              onClick={onClick}
            >
              <octahedronGeometry args={[0.11, 0]} />
              <meshStandardMaterial
                color={SEVERITY_COLOR[a.severity]}
                emissive={SEVERITY_COLOR[a.severity]}
                emissiveIntensity={0.5}
                toneMapped={false}
              />
            </mesh>
          </Select>
        );
      })}
    </>
  );
}
