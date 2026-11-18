import { Line } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cellKey, useTwinStore } from '../store/twin-store';
import { SEVERITY_COLOR, STATE_STYLE, cellVisualState, seamView, sortedAlarms } from './cell-view';
import { deg, type V3 } from './frame';
import { alarmName, labelTestId, objectName } from './names';
import type { CellConfig } from './plate';
import { Robot } from './Robot';
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

interface Props {
  site: string;
  cell: CellConfig;
}

/** 셀 하나: 셀 원점 → 작업판(+용접선), 로봇, 상태 램프와 라벨, 알람 마커. 사이트 좌표계(Z-up) 안에 놓인다. */
export function Cell({ site, cell }: Props) {
  const { plate, robot } = cell;
  return (
    <group name={objectName('cell', site, cell.id)} position={cell.pose.position_m} rotation-z={deg(cell.pose.yaw_deg)}>
      <group position={plate.pose.position_m} rotation-z={deg(plate.pose.yaw_deg)}>
        <Plate site={site} cellId={cell.id} sizeMm={plate.size_mm} />
        <Seam site={site} cellId={cell.id} />
      </group>
      {robot.urdf && (
        <group position={robot.pose.position_m} rotation-z={deg(robot.pose.yaw_deg)}>
          <Robot site={site} cellId={cell.id} url={robot.urdf} />
        </group>
      )}
      <StatusLamp site={site} cell={cell} />
      <AlarmMarkers site={site} cellId={cell.id} />
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

/** DY-04 셀 상태색 + IX-04 셀 라벨. 램프 기둥 위에 이름과 상태를 띄운다 */
function StatusLamp({ site, cell }: Props) {
  const key = cellKey(site, cell.id);
  const state = useTwinStore((s) => cellVisualState(s.cells[key]));
  const style = STATE_STYLE[state];
  const dataset = useMemo(() => ({ state }), [state]);
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
function AlarmMarkers({ site, cellId }: { site: string; cellId: string }) {
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
              position={[ALARM_BASE[0], ALARM_BASE[1], ALARM_BASE[2] + i * ALARM_STEP_M]}
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
