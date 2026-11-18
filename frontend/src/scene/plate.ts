import type { SiteConfig } from '../contracts/messages.gen';
import { deg, type V3 } from './frame';

export type CellConfig = SiteConfig['cells'][number];

function rotZ([x, y, z]: V3, yawDeg: number): V3 {
  const r = deg(yawDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * x - s * y, s * x + c * y, z];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * SC-02: 작업판 좌표(mm) → 사이트 좌표(m).
 * 판 좌표: 판의 원점 모서리, 판 윗면이 XY, 위가 +Z(contracts 좌표계). 셀·판의 자세는 site-config.
 */
export function plateToSite(cell: CellConfig, [xmm, ymm]: readonly [number, number], zmm = 0): V3 {
  const plate = cell.plate;
  if (!plate) throw new Error(`${cell.id}에 작업판이 없다(이동 로봇은 surface 좌표를 쓴다)`);
  const inPlate: V3 = [xmm / 1000, ymm / 1000, zmm / 1000];
  const inCell = add(rotZ(inPlate, plate.pose.yaw_deg), plate.pose.position_m);
  return add(rotZ(inCell, cell.pose.yaw_deg), cell.pose.position_m);
}
