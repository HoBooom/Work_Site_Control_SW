// contracts/schemas → frontend/src/contracts/messages.gen.ts
//   node contracts/gen-types.mjs           생성
//   node contracts/gen-types.mjs --check   생성 결과가 파일과 다르면 실패(L0)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, 'schemas');
const out = join(here, '..', 'frontend', 'src', 'contracts', 'messages.gen.ts');
const topics = JSON.parse(readFileSync(join(here, 'topics.json'), 'utf8'));

const files = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort();
const parts = [
  '/* 생성 파일. 직접 고치지 않는다. contracts/schemas를 고친 뒤 `npm run gen:types`. */',
  '/* eslint-disable */',
  '',
];
const titles = {};
for (const f of files) {
  const schema = JSON.parse(readFileSync(join(schemasDir, f), 'utf8'));
  titles[schema.$id] = schema.title;
  parts.push(
    await compile(schema, schema.title, {
      bannerComment: '',
      cwd: schemasDir,
      additionalProperties: false,
      format: true,
      style: { singleQuote: true, printWidth: 100 },
    }),
  );
}
parts.push(`export const TOPIC_PREFIX = '${topics.prefix}';`, '');
parts.push('/** 셀 토픽 접미사 → payload 타입 */', 'export interface CellTopicPayloads {');
for (const t of topics.cell_topics) {
  if (!titles[t.schema]) throw new Error(`topics.json: 스키마 없음 ${t.schema}`);
  parts.push(`  '${t.suffix}': ${titles[t.schema]};`);
}
parts.push('}', '', 'export type CellTopicSuffix = keyof CellTopicPayloads;', '');
parts.push(
  `export const CELL_TOPIC_SUFFIXES: readonly CellTopicSuffix[] = [${topics.cell_topics
    .map((t) => `'${t.suffix}'`)
    .join(', ')}];`,
  '',
);
const text = parts.join('\n');

if (process.argv.includes('--check')) {
  const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (cur !== text) {
    console.error('messages.gen.ts가 contracts/schemas와 다르다. `npm run gen:types`를 실행한다.');
    process.exit(1);
  }
  console.log('messages.gen.ts 최신');
} else {
  writeFileSync(out, text);
  console.log(`생성: ${out}`);
}
