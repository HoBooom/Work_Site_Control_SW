import type { QualityTier } from '../scene/quality';

export type { QualityTier };

export interface LabParams {
  /** null이면 첫 번째 사이트 */
  site: string | null;
  /** null이면 그 사이트의 `{site}-idle`(없으면 첫 픽스처) */
  fixture: string | null;
  t: number;
  /** null이면 site-config의 첫 번째 프리셋 */
  preset: string | null;
  /** null이면 기기에 따라 자동(RD-05) */
  quality: QualityTier | null;
  freeze: boolean;
  hud: boolean;
  /** M5: fixture(픽스처 재생, 기본) 또는 mqtt(브로커 구독) */
  source: 'fixture' | 'mqtt';
  /** mqtt 모드의 브로커 웹소켓 주소. null이면 웹을 연 호스트의 9001 */
  broker: string | null;
}

/** `/lab?site=…&fixture=…&t=…&preset=…&quality=…&freeze=1&hud=0`, 실시간은 `/lab?site=…&source=mqtt&broker=ws://…:9001` */
export function parseLabParams(search: string): LabParams {
  const q = new URLSearchParams(search);
  const t = Number(q.get('t') ?? '0');
  if (!Number.isFinite(t) || t < 0) throw new Error(`t는 0 이상의 숫자다: ${q.get('t')}`);
  const quality = q.get('quality');
  if (quality !== null && quality !== 'high' && quality !== 'low') throw new Error(`quality는 high 또는 low다: ${quality}`);
  const source = q.get('source') ?? 'fixture';
  if (source !== 'fixture' && source !== 'mqtt') throw new Error(`source는 fixture 또는 mqtt다: ${source}`);
  return {
    site: q.get('site'),
    fixture: q.get('fixture'),
    t,
    preset: q.get('preset'),
    quality,
    freeze: q.get('freeze') === '1',
    hud: q.get('hud') !== '0',
    source,
    broker: q.get('broker'),
  };
}
