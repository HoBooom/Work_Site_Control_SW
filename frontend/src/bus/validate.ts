import Ajv, { type ValidateFunction } from 'ajv';
import type { CellTopicSuffix } from '../contracts/messages.gen';

// contracts/schemas와 topics.json을 그대로 읽는다(복사본 없음). L0 validate-data.mjs와 같은 설정의 ajv
const schemas = import.meta.glob<object>('../../../contracts/schemas/*.schema.json', { eager: true, import: 'default' });
const topicsFile = import.meta.glob<{ cell_topics: { suffix: string; schema: string }[] }>('../../../contracts/topics.json', {
  eager: true,
  import: 'default',
});
const topics = Object.values(topicsFile)[0];

const ajv = new Ajv({ allErrors: false, strict: true });
for (const s of Object.values(schemas)) ajv.addSchema(s);
const schemaOf = new Map(topics.cell_topics.map((t) => [t.suffix, t.schema]));
const compiled = new Map<string, ValidateFunction>();

/** 셀 토픽 payload를 계약 스키마로 검사한다. 맞으면 null, 아니면 이유 */
export function validatePayload(suffix: CellTopicSuffix | string, payload: unknown): string | null {
  const id = schemaOf.get(suffix);
  if (!id) return `topics.json에 없는 토픽: ${suffix}`;
  let v = compiled.get(id);
  if (!v) {
    v = ajv.getSchema(id);
    if (!v) return `스키마 없음: ${id}`;
    compiled.set(id, v);
  }
  if (v(payload)) return null;
  const e = v.errors?.[0];
  return `${id}: ${e?.instancePath || '/'} ${e?.message ?? '형식 오류'}`;
}

/** 스키마 id로 검사(계약 예시 검사용) */
export function validateBySchema(id: string, payload: unknown): string | null {
  const v = ajv.getSchema(id);
  if (!v) return `스키마 없음: ${id}`;
  return v(payload) ? null : `${id}: ${v.errors?.[0]?.message ?? '형식 오류'}`;
}
