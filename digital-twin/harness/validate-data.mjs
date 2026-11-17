// L0 데이터 검사: 스키마 컴파일, site-config, 픽스처.
//   node digital-twin/harness/validate-data.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => relative(root, p);
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

// 1. 스키마
const ajv = new Ajv({ allErrors: true, strict: true });
const schemasDir = join(root, 'contracts', 'schemas');
for (const f of readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))) {
  try {
    ajv.addSchema(JSON.parse(readFileSync(join(schemasDir, f), 'utf8')));
  } catch (e) {
    fail(`contracts/schemas/${f}`, e.message);
  }
}
const topics = JSON.parse(readFileSync(join(root, 'contracts', 'topics.json'), 'utf8'));
const schemaBySuffix = new Map(topics.cell_topics.map((t) => [t.suffix, t.schema]));
for (const [suffix, id] of schemaBySuffix) {
  if (!ajv.getSchema(id)) fail('contracts/topics.json', `${suffix}의 스키마 ${id}가 없다`);
}
const fmt = (errs) => errs.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');

// 2. site-config
const cellsBySite = new Map();
const configDir = join(root, 'digital-twin', 'site-config');
const validateConfig = ajv.getSchema('site-config');
for (const f of readdirSync(configDir).filter((f) => f.endsWith('.json'))) {
  const where = rel(join(configDir, f));
  const cfg = JSON.parse(readFileSync(join(configDir, f), 'utf8'));
  if (!validateConfig(cfg)) {
    fail(where, fmt(validateConfig.errors));
    continue;
  }
  if (cfg.site !== f.replace(/\.json$/, '')) fail(where, `파일 이름과 site(${cfg.site})가 다르다`);
  for (const key of ['cells', 'presets']) {
    const ids = cfg[key].map((x) => x.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) fail(where, `${key} id 중복: ${dup.join(', ')}`);
  }
  cellsBySite.set(cfg.site, new Set(cfg.cells.map((c) => c.id)));
}

// 3. 픽스처
const fixturesDir = join(root, 'digital-twin', 'fixtures');
const topicRe = new RegExp(`^${topics.prefix}/([a-z0-9-]+)/([a-z0-9-]+)/(.+)$`);
let fixtureCount = 0;
for (const f of readdirSync(fixturesDir).filter((f) => f.endsWith('.jsonl'))) {
  fixtureCount++;
  let lastT = 0;
  readFileSync(join(fixturesDir, f), 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      if (!raw.trim()) return;
      const where = `${rel(join(fixturesDir, f))}:${i + 1}`;
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return fail(where, 'JSON이 아니다');
      }
      if (!Number.isInteger(m.t) || m.t < 0) return fail(where, 't는 0 이상의 정수');
      if (m.t < lastT) fail(where, `t가 줄어든다(${lastT} → ${m.t})`);
      lastT = m.t;
      const tm = topicRe.exec(m.topic ?? '');
      if (!tm) return fail(where, `셀 토픽이 아니다: ${m.topic}`);
      const [, site, cell, suffix] = tm;
      if (!cellsBySite.has(site)) fail(where, `site-config에 없는 사이트: ${site}`);
      else if (!cellsBySite.get(site).has(cell)) fail(where, `${site}에 없는 셀: ${cell}`);
      const id = schemaBySuffix.get(suffix);
      if (!id) return fail(where, `topics.json에 없는 토픽: ${suffix}`);
      const validate = ajv.getSchema(id);
      if (validate && !validate(m.payload)) fail(where, `${id}: ${fmt(validate.errors)}`);
    });
}

if (errors.length) {
  console.error(errors.slice(0, 50).join('\n'));
  if (errors.length > 50) console.error(`… 외 ${errors.length - 50}건`);
  process.exit(1);
}
console.log(`스키마 ${schemaBySuffix.size + 1}개, site-config ${cellsBySite.size}개, 픽스처 ${fixtureCount}개 통과`);
