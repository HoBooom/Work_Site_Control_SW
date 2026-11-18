import type { SiteConfig } from '../contracts/messages.gen';
import type { V3 } from './frame';
import { plateToSite, type CellConfig } from './plate';

/** 강판 면(ADR 0003). 원점 = 면 모서리, 면 위가 XY, +Z = 로봇이 붙는 쪽 */
export type SurfaceConfig = NonNullable<SiteConfig['surfaces']>[number];

/** 단위 쿼터니언 [x, y, z, w]으로 벡터를 돌린다 */
export function rotateByQuat([qx, qy, qz, qw]: readonly number[], [vx, vy, vz]: V3): V3 {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** 면 좌표(mm) → 사이트 좌표(m). zmm은 면 법선 방향 높이 */
export function surfaceToSite(s: SurfaceConfig, [xmm, ymm]: readonly [number, number], zmm = 0): V3 {
  const r = rotateByQuat(s.pose.orientation_xyzw, [xmm / 1000, ymm / 1000, zmm / 1000]);
  const p = s.pose.position_m;
  return [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
}

export function surfaceCorners(s: SurfaceConfig): V3[] {
  const [w, h] = s.size_mm;
  return ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]).map((c) => surfaceToSite(s, c));
}

export function findSurface(config: Pick<SiteConfig, 'surfaces'>, id: string): SurfaceConfig {
  const s = config.surfaces?.find((x) => x.id === id);
  if (!s) throw new Error(`site-config에 없는 surface: ${id}`);
  return s;
}

/** 경로 점(mm) → 사이트 좌표. surface가 있으면 그 면, 없으면 셀 작업판(contracts "작업 단위") */
export function pathPointToSite(
  config: Pick<SiteConfig, 'surfaces'>,
  cell: CellConfig,
  surface: string | undefined,
  pt: readonly [number, number],
  zmm = 0,
): V3 {
  return surface ? surfaceToSite(findSurface(config, surface), pt, zmm) : plateToSite(cell, pt, zmm);
}
