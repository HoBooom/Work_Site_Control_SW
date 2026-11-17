import { parseFixture, type FixtureLine } from './fixture';

// digital-twin/fixtures/*.jsonl을 그대로 읽는다. tools/play.py와 같은 파일이다.
const modules = import.meta.glob<string>('../../../digital-twin/fixtures/*.jsonl', {
  query: '?raw',
  import: 'default',
});

const byName = new Map(
  Object.entries(modules).map(([path, load]) => [path.split('/').pop()!.replace(/\.jsonl$/, ''), load]),
);

export function listFixtures(): string[] {
  return [...byName.keys()].sort();
}

export async function loadFixture(name: string): Promise<FixtureLine[]> {
  const load = byName.get(name);
  if (!load) throw new Error(`픽스처 없음: ${name} (있는 것: ${listFixtures().join(', ') || '없음'})`);
  return parseFixture(await load(), `${name}.jsonl`);
}
