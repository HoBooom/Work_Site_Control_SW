// 픽스처(JSONL)를 MQTT 브로커로 재생한다. 서버가 없을 때 서버 대신 상태를 보낸다(M5).
//   node tools/play.mjs <픽스처 이름> [--url mqtt://localhost:1883] [--speed 1] [--loop] [--keep-ts]
// 트윈 랩(source=mqtt)·관제 화면이 같은 파일을 픽스처 재생기로 볼 때와 같은 상태가 되어야 한다(harness/e2e/mqtt.spec.ts).
//
// - 로봇(셀)마다 연결을 하나씩 열고 유언(LWT) status=offline(retained)을 건다. 비정상 종료하면 브로커가 대신 보낸다.
// - QoS·retained는 contracts/topics.json을 따른다. 시작할 때 픽스처에 나오는 셀마다 계약의 retained 토픽을 모두 비운다
//   (앞 재생이 남긴 상태가 섞이지 않게. --no-clear로 끔).
// - payload.ts는 보낼 때 시각(epoch ms)으로 바꾼다. --keep-ts면 픽스처 값 그대로(검사가 픽스처 재생과 비교할 때).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import mqtt from 'mqtt';

const root = new URL('../', import.meta.url);
const topics = JSON.parse(readFileSync(new URL('contracts/topics.json', root), 'utf8'));
const bySuffix = new Map(topics.cell_topics.map((t) => [t.suffix, t]));

/** @returns {{ t: number, topic: string, payload: Record<string, unknown> }[]} */
export function readFixture(name) {
  return readFileSync(new URL(`digital-twin/fixtures/${name}.jsonl`, root), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function parse(topic) {
  const [prefix, site, cell, ...rest] = topic.split('/');
  const spec = bySuffix.get(rest.join('/'));
  if (prefix !== topics.prefix || !site || !cell || !spec) throw new Error(`셀 토픽이 아니다: ${topic}`);
  return { site, cell, spec };
}

const connect = (url, opts) =>
  new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 5000, ...opts });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });

const publish = (c, topic, body, qos, retain) =>
  new Promise((resolve, reject) => c.publish(topic, body, { qos, retain }, (e) => (e ? reject(e) : resolve())));

/**
 * @param {{ t: number, topic: string, payload: Record<string, unknown> }[]} lines
 * @param {{ url?: string, speed?: number, until?: number, instant?: boolean, keepTs?: boolean, clear?: boolean, signal?: AbortSignal }} [opts]
 *   instant: 시간 간격 없이 순서대로 바로 보낸다(until까지). 아니면 t/speed 간격으로 보낸다.
 * @returns {Promise<{ sent: number, end: () => Promise<void>, kill: () => void }>}
 *   end: 정상 종료(유언 없음). kill: 소켓을 끊어 비정상 종료를 흉내 낸다(브로커가 유언을 보낸다).
 */
export async function playFixture(lines, opts = {}) {
  const { url = 'mqtt://localhost:1883', speed = 1, until = Infinity, instant = false, keepTs = false, clear = true, signal } = opts;
  const clients = new Map();
  for (const l of lines) {
    const { site, cell } = parse(l.topic);
    const key = `${site}/${cell}`;
    if (clients.has(key)) continue;
    const will = { topic: `${topics.prefix}/${key}/status`, payload: JSON.stringify({ v: 1, ts: Date.now(), state: 'offline' }), qos: 1, retain: true };
    clients.set(key, await connect(url, { clientId: `play-${key.replace('/', '-')}-${process.pid}`, will }));
  }
  const clientOf = (topic) => clients.get(parse(topic).site + '/' + parse(topic).cell);
  if (clear) {
    const retainedSuffixes = topics.cell_topics.filter((t) => t.retained).map((t) => t.suffix);
    for (const [key, c] of clients) {
      for (const suffix of retainedSuffixes) await publish(c, `${topics.prefix}/${key}/${suffix}`, '', 1, true);
    }
  }
  let sent = 0;
  const start = performance.now();
  for (const l of lines) {
    if (l.t > until || signal?.aborted) break;
    if (!instant) {
      const wait = start + l.t / speed - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    const { spec } = parse(l.topic);
    const payload = keepTs ? l.payload : { ...l.payload, ts: Date.now() };
    await publish(clientOf(l.topic), l.topic, JSON.stringify(payload), spec.qos, spec.retained);
    sent++;
  }
  return {
    sent,
    end: async () => {
      await Promise.all([...clients.values()].map((c) => new Promise((r) => c.end(false, {}, () => r()))));
    },
    kill: () => {
      for (const c of clients.values()) c.stream.destroy();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('사용법: node tools/play.mjs <픽스처 이름> [--url mqtt://localhost:1883] [--speed 1] [--loop] [--keep-ts]');
    process.exit(2);
  }
  const opt = (flag, fallback) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : fallback);
  const url = opt('--url', 'mqtt://localhost:1883');
  const speed = Number(opt('--speed', 1));
  const lines = readFixture(name);
  do {
    const p = await playFixture(lines, { url, speed, keepTs: rest.includes('--keep-ts'), clear: !rest.includes('--no-clear') });
    console.log(`${name}: 메시지 ${p.sent}개 보냄(${url}, ${speed}배)`);
    await p.end();
  } while (rest.includes('--loop'));
}
