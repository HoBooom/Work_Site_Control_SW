// 테스트가 기대값을 계산할 때 쓰는 원본 데이터. 씬이 아니라 파일에서 직접 읽는다.
import { readFileSync, readdirSync } from 'node:fs';
import type { SiteConfig } from '../../../frontend/src/contracts/messages.gen';

const root = new URL('../../../', import.meta.url);

export function siteConfig(site: string): SiteConfig {
  return JSON.parse(readFileSync(new URL(`digital-twin/site-config/${site}.json`, root), 'utf8'));
}

/** digital-twin/site-config/에 있는 사이트 전부. 프론트의 listSites()와 같은 목록을 파일에서 직접 만든다 */
export function allSites(): string[] {
  return readdirSync(new URL('digital-twin/site-config/', root))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function allFixtures(): string[] {
  return readdirSync(new URL('digital-twin/fixtures/', root))
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
}

const topicSite = (topic: string) => topic.split('/')[1];

/** 모든 토픽이 그 사이트의 것인 픽스처 이름 */
export function fixturesOfSite(site: string): string[] {
  return allFixtures().filter((name) => fixture(name).every((l) => topicSite(l.topic) === site));
}

export interface Line {
  t: number;
  topic: string;
  payload: Record<string, unknown>;
}

export function fixture(name: string): Line[] {
  return readFileSync(new URL(`digital-twin/fixtures/${name}.jsonl`, root), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** 고정 로봇 셀의 작업판. 없으면(이동 로봇) 테스트를 실패시킨다 */
export function plateOf(cell: SiteConfig['cells'][number]) {
  if (!cell.plate) throw new Error(`${cell.id}에 작업판이 없다`);
  return cell.plate;
}

const T0 = 1_767_225_600_000;
export const tsAt = (t: number) => T0 + t;

/** 픽스처의 robot/state를 셀별로 시각 r에서 선형 보간한 관절각. 씬과 별개로 계산한다. */
export function expectedJoints(lines: Line[], site: string, cell: string, r: number): Record<string, number> {
  const topic = `innoworks/${site}/${cell}/robot/state`;
  const samples = lines.filter((l) => l.topic === topic) as (Line & { payload: { joints: Record<string, number> } })[];
  if (r <= samples[0].t) return samples[0].payload.joints;
  const last = samples[samples.length - 1];
  if (r >= last.t) return last.payload.joints;
  const i = samples.findIndex((s, k) => s.t <= r && samples[k + 1].t > r);
  const a = samples[i];
  const b = samples[i + 1];
  const k = (r - a.t) / (b.t - a.t);
  return Object.fromEntries(Object.entries(a.payload.joints).map(([n, va]) => [n, va + (b.payload.joints[n] - va) * k]));
}

export function lastPayload(lines: Line[], topic: string, t: number): Record<string, unknown> | undefined {
  return lines.filter((l) => l.topic === topic && l.t <= t).at(-1)?.payload;
}
