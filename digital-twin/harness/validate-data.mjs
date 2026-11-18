// L0 데이터 검사: 스키마 컴파일, 계약 예시(contracts/examples), site-config, 픽스처.
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

// 스키마로 못 거르는 규칙(메시지 하나만 보고 판단). 오류 문자열 배열을 돌려준다
const QUAT_TOL = 1e-3;
const quatOk = (q) => Math.abs(Math.hypot(...q) - 1) <= QUAT_TOL;
function payloadRules(schemaId, p) {
  const out = [];
  if (schemaId === 'robot-state' && p.base && !quatOk(p.base.orientation_xyzw)) out.push('base.orientation_xyzw가 단위 쿼터니언이 아니다');
  if (schemaId === 'site-config') {
    for (const s of p.surfaces ?? []) if (!quatOk(s.pose.orientation_xyzw)) out.push(`surface ${s.id}: 단위 쿼터니언이 아니다`);
  }
  return out;
}

// 1-1. 계약 예시: valid는 통과, invalid는 실패해야 한다
const examplesDir = join(root, 'contracts', 'examples');
let exampleCount = 0;
for (const kind of ['valid', 'invalid']) {
  for (const f of readdirSync(join(examplesDir, kind)).filter((f) => f.endsWith('.json'))) {
    exampleCount++;
    const where = `contracts/examples/${kind}/${f}`;
    const ex = JSON.parse(readFileSync(join(examplesDir, kind, f), 'utf8'));
    const validate = ajv.getSchema(ex.schema);
    if (!validate) {
      fail(where, `스키마 없음: ${ex.schema}`);
      continue;
    }
    const schemaOk = validate(ex.payload);
    const problems = schemaOk ? payloadRules(ex.schema, ex.payload) : [fmt(validate.errors)];
    if (kind === 'valid' && problems.length) fail(where, `통과해야 하는데 실패: ${problems.join('; ')}`);
    if (kind === 'invalid' && !problems.length) fail(where, `실패해야 하는데 통과(${ex.why})`);
  }
}

// 2. site-config
const cellsBySite = new Map();
const configBySite = new Map();
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
  payloadRules('site-config', cfg).forEach((m) => fail(where, m));
  for (const key of ['cells', 'presets', 'surfaces']) {
    const ids = (cfg[key] ?? []).map((x) => x.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) fail(where, `${key} id 중복: ${dup.join(', ')}`);
  }
  cellsBySite.set(cfg.site, new Set(cfg.cells.map((c) => c.id)));
  configBySite.set(cfg.site, cfg);
}

/** 경로가 가리키는 면(surface 또는 셀 작업판)의 크기(mm). 못 찾으면 오류 문자열 */
function pathFrame(cfg, cellId, surface) {
  if (surface) {
    const s = (cfg.surfaces ?? []).find((x) => x.id === surface);
    return s ? { size: s.size_mm, name: `surface ${surface}` } : `site-config에 없는 surface: ${surface}`;
  }
  const cell = cfg.cells.find((c) => c.id === cellId);
  return cell?.plate ? { size: cell.plate.size_mm, name: `${cellId} 작업판` } : `${cellId}에 작업판이 없다. surface를 적어야 한다`;
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
      if (validate && !validate(m.payload)) return fail(where, `${id}: ${fmt(validate.errors)}`);
      payloadRules(id, m.payload).forEach((msg) => fail(where, msg));
      const cfg = configBySite.get(site);
      if (!cfg) return;
      // 경로는 가리키는 면 안에 있어야 한다
      if (suffix === 'task/proposal' || suffix === 'task/snap') {
        const frame = pathFrame(cfg, cell, m.payload.surface);
        if (typeof frame === 'string') return fail(where, frame);
        const [w, h] = frame.size;
        const out = m.payload.path.findIndex(([x, y]) => x < 0 || y < 0 || x > w || y > h);
        if (out >= 0) fail(where, `경로 점 ${out}이 ${frame.name}(${w}×${h}mm) 밖`);
      }
      const base = suffix === 'robot/state' ? m.payload.base : null;
      if (base?.surface && !(cfg.surfaces ?? []).some((x) => x.id === base.surface)) fail(where, `site-config에 없는 surface: ${base.surface}`);
    });
}

if (errors.length) {
  console.error(errors.slice(0, 50).join('\n'));
  if (errors.length > 50) console.error(`… 외 ${errors.length - 50}건`);
  process.exit(1);
}
console.log(`스키마 ${schemaBySuffix.size + 1}개, 계약 예시 ${exampleCount}개, site-config ${cellsBySite.size}개, 픽스처 ${fixtureCount}개 통과`);
