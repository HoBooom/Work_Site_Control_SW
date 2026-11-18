import { describe, expect, it } from 'vitest';
import { validateBySchema, validatePayload } from './validate';

// contracts/examples: valid는 통과, invalid는 실패(단, 스키마로 못 거르는 의미 규칙 예시는 L0 validate-data가 맡는다)
const examples = import.meta.glob<{ schema: string; why: string; payload: unknown }>('../../../contracts/examples/*/*.json', {
  eager: true,
  import: 'default',
});
const SEMANTIC = /의미 검사/;

describe('bus 메시지 검증', () => {
  it('계약 예시: valid는 통과, 스키마로 거를 수 있는 invalid는 실패', () => {
    const entries = Object.entries(examples);
    expect(entries.length).toBeGreaterThan(5);
    for (const [path, ex] of entries) {
      const err = validateBySchema(ex.schema, ex.payload);
      if (path.includes('/valid/')) expect(err, path).toBeNull();
      else if (!SEMANTIC.test(ex.why)) expect(err, path).not.toBeNull();
    }
  });

  it('토픽 접미사로 스키마를 고른다', () => {
    expect(validatePayload('status', { v: 1, ts: 1, state: 'online' })).toBeNull();
    expect(validatePayload('robot/state', { v: 1, ts: 1 })).toMatch(/robot-state/);
    expect(validatePayload('nope', {})).toMatch(/topics.json/);
  });
});
