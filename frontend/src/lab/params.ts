export type QualityTier = 'high' | 'low';

export interface LabParams {
  /** null이면 첫 번째 사이트 */
  site: string | null;
  fixture: string;
  t: number;
  /** null이면 site-config의 첫 번째 프리셋 */
  preset: string | null;
  quality: QualityTier;
  freeze: boolean;
  hud: boolean;
}

/** `/lab?site=…&fixture=…&t=…&preset=…&quality=…&freeze=1&hud=0` */
export function parseLabParams(search: string): LabParams {
  const q = new URLSearchParams(search);
  const t = Number(q.get('t') ?? '0');
  if (!Number.isFinite(t) || t < 0) throw new Error(`t는 0 이상의 숫자다: ${q.get('t')}`);
  const quality = q.get('quality') ?? 'high';
  if (quality !== 'high' && quality !== 'low') throw new Error(`quality는 high 또는 low다: ${quality}`);
  return {
    site: q.get('site'),
    fixture: q.get('fixture') ?? 'idle',
    t,
    preset: q.get('preset'),
    quality,
    freeze: q.get('freeze') === '1',
    hud: q.get('hud') !== '0',
  };
}
