// MQTT Mock 서버(프론트 F0~F4). 서버(FastAPI) 전에 서버 자리를 대신한다(frontend/docs/spec.md 3~5절, ADR 0005).
//   node tools/mock-server.mjs [--site ship-block] [--url mqtt://localhost:1883] [--http 8090] [--propose-ms 1500]
//
// - 로봇(셀)마다 MQTT 연결 + 유언 status=offline. 상태 머신(tools/mock/machine.mjs)대로 명령에 답한다.
// - 대기 중인 로봇에 일정 시간 뒤 용접선을 제안한다(Mock 비전). 진행률·메트릭·로봇 자세를 보낸다.
// - HTTP: /stream/{cell}(지금 영상), /frames/{frame_id}(멈춘 프레임). 그림은 tools/mock/frames.mjs가 그린다.
// - 보내는 메시지는 모두 계약(contracts/schemas)으로 검사한다. 어기면 예외(Mock이 계약을 어기지 않게).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import mqtt from 'mqtt';
import { makeFrame } from './mock/frames.mjs';
import { command, createUnit, pause, propose, snapshot, tick } from './mock/machine.mjs';

const root = new URL('../', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const topics = readJson('contracts/topics.json');
const P = topics.prefix;
const cellSpec = new Map(topics.cell_topics.map((t) => [t.suffix, t]));
const cmdSpec = new Map(topics.command_topics.map((t) => [t.suffix, t]));

const ajv = new Ajv({ strict: true });
for (const f of ['alarm', 'robot-state', 'status', 'task-progress', 'task-proposal', 'task-snap', 'task-state', 'vision-metrics', 'heartbeat', ...topics.command_topics.map((t) => t.schema)]) {
  ajv.addSchema(readJson(`contracts/schemas/${f}.schema.json`));
}

const connect = (url, opts) =>
  new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { reconnectPeriod: 1000, connectTimeout: 5000, ...opts });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });

/** 픽스처의 robot/state를 셀별 시간순 배열로(로봇 움직임 원본) */
function motionTracks(fixture) {
  const out = new Map();
  const text = readFileSync(new URL(`digital-twin/fixtures/${fixture}.jsonl`, root), 'utf8');
  for (const line of text.split('\n').filter(Boolean)) {
    const m = JSON.parse(line);
    if (!m.topic.endsWith('/robot/state')) continue;
    const cell = m.topic.split('/')[2];
    if (!out.has(cell)) out.set(cell, []);
    out.get(cell).push({ t: m.t, p: m.payload });
  }
  return out;
}

/** 시각 t의 자세: 관절은 앞뒤 샘플 사이를 선형 보간, 몸통·발 접촉은 앞 샘플 */
function poseAt(track, t) {
  if (!track?.length) return null;
  let i = track.findIndex((s) => s.t > t);
  if (i === -1) return track[track.length - 1].p;
  if (i === 0) return track[0].p;
  const a = track[i - 1];
  const b = track[i];
  const k = (t - a.t) / (b.t - a.t);
  const joints = Object.fromEntries(Object.entries(a.p.joints).map(([n, v]) => [n, Math.round((v + ((b.p.joints[n] ?? v) - v) * k) * 1000) / 1000]));
  return { ...a.p, joints };
}

/** 상태·진행률 → 움직임 픽스처의 시각 */
function motionTime(motion, u) {
  const [r0, r1] = motion.run;
  if (u.state === 'running' || u.state === 'paused' || (u.state === 'estopped' && u.progress > 0)) return r0 + (r1 - r0) * u.progress;
  if (u.state === 'completed') return motion.done_t;
  return motion.idle_t;
}

/**
 * @param {{ site?: string, url?: string, httpPort?: number, proposeMs?: number, runMs?: number, heartbeatTimeoutMs?: number, tickMs?: number, log?: boolean }} [opts]
 */
export async function startMockServer(opts = {}) {
  const { site = 'ship-block', url = 'mqtt://localhost:1883', httpPort = 8090, proposeMs = 1500, runMs, heartbeatTimeoutMs = 3000, tickMs = 100, log = false } = opts;
  const mock = readJson('tools/mock/sites.json')[site];
  if (!mock) throw new Error(`tools/mock/sites.json에 ${site}가 없다`);
  const config = readJson(`digital-twin/site-config/${site}.json`);
  const tracks = motionTracks(mock.motion.fixture);

  // 셀별 영상 그림과 상태 머신
  const frames = new Map();
  const units = new Map();
  for (const [i, cell] of config.cells.map((c) => c.id).entries()) {
    const m = mock[cell];
    if (cell === 'motion') continue;
    if (!m) throw new Error(`tools/mock/sites.json ${site}에 ${cell}이 없다`);
    const f = makeFrame({ kind: m.frame, seam_mm: m.seam_mm, seed: i + 1 });
    frames.set(cell, f);
    units.set(cell, createUnit({ cell, frame: { surface: m.surface ?? undefined, size: f.size, seam_px: f.seam_px, H: f.H }, ...(runMs ? { runMs } : {}) }));
  }

  // 셀마다 연결(유언), 명령·heartbeat를 받는 연결 하나
  // 연결 id는 인스턴스마다 다르게: 같은 id로 다시 붙으면 브로커가 앞 연결을 끊어(세션 인계) 연결이 엉킬 수 있다
  const instance = Math.random().toString(16).slice(2, 8);
  const clients = new Map();
  for (const cell of units.keys()) {
    const will = { topic: `${P}/${site}/${cell}/status`, payload: JSON.stringify({ v: 1, ts: Date.now(), state: 'offline' }), qos: 1, retain: true };
    clients.set(cell, await connect(url, { clientId: `mock-server-${site}-${cell}-${instance}`, will }));
  }
  const control = await connect(url, { clientId: `mock-server-${site}-control-${instance}` });

  const send = (cell, { suffix, payload }) => {
    const spec = cellSpec.get(suffix);
    const body = { v: 1, ts: Date.now(), ...payload };
    if (suffix === 'task/proposal' || suffix === 'task/snap') {
      if (body.surface === undefined) delete body.surface;
    }
    const validate = ajv.getSchema(spec.schema);
    if (!validate(body)) throw new Error(`Mock이 계약을 어겼다: ${suffix} ${JSON.stringify(validate.errors)}`);
    clients.get(cell).publish(`${P}/${site}/${cell}/${suffix}`, JSON.stringify(body), { qos: spec.qos, retain: spec.retained });
  };
  const sendAll = (cell, out) => out.forEach((m) => send(cell, m));

  // 처음 상태: online, 대기, 자세
  for (const [cell, u] of units) {
    send(cell, { suffix: 'status', payload: { state: 'online' } });
    sendAll(cell, snapshot(u));
  }

  // 대기 → 일정 시간 뒤 제안(Mock 비전)
  const idleSince = new Map([...units.keys()].map((c) => [c, Date.now()]));
  let lastHeartbeat = 0;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const now = Date.now();
    for (const [cell, u] of units) {
      if (u.state !== 'idle') idleSince.set(cell, now);
      else if (now - idleSince.get(cell) >= proposeMs) sendAll(cell, propose(u, now));
      sendAll(cell, tick(u, now));
      if (lastHeartbeat && now - lastHeartbeat > heartbeatTimeoutMs) sendAll(cell, pause(u, `운영자 화면 응답 없음(${Math.round((now - lastHeartbeat) / 1000)}초)`));
      const pose = poseAt(tracks.get(cell), motionTime(mock.motion, u));
      if (pose) send(cell, { suffix: 'robot/state', payload: { joints: pose.joints, ...(pose.base ? { base: pose.base } : {}), ...(pose.contacts ? { contacts: pose.contacts } : {}) } });
    }
  }, tickMs);

  const metricsTimer = setInterval(() => {
    if (stopped) return;
    for (const [cell, u] of units) {
      const t = Date.now() / 1000;
      send(cell, {
        suffix: 'vision/metrics',
        payload: {
          latency_ms: Math.round((70 + 15 * Math.sin(t / 3) + 5 * Math.sin(t * 1.7)) * 10) / 10,
          confidence: u.proposal?.confidence ?? 0,
          disturbance: Math.round((0.12 + 0.08 * Math.sin(t / 5)) * 100) / 100,
        },
      });
    }
  }, 1000);

  // 명령
  await new Promise((r) => control.subscribe([`${P}/${site}/+/cmd/#`, `${P}/${site}/cmd/#`, `${P}/operator/+/heartbeat`], { qos: 1 }, () => r()));
  control.on('message', (topic, buf) => {
    let payload;
    try {
      payload = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const parts = topic.split('/');
    if (parts[1] === 'operator') {
      if (ajv.getSchema('heartbeat')(payload) && payload.site === site) lastHeartbeat = Date.now();
      return;
    }
    const siteScope = parts[2] === 'cmd';
    const suffix = siteScope ? parts.slice(2).join('/') : parts.slice(3).join('/');
    const spec = cmdSpec.get(suffix);
    if (!spec) return;
    const name = suffix.replace('cmd/', '');
    const targets = siteScope ? [...units.keys()] : [parts[2]];
    if (siteScope && !spec.scopes.includes('site')) return;
    if (!ajv.getSchema(spec.schema)(payload)) {
      for (const cell of targets.filter((c) => units.has(c))) {
        send(cell, { suffix: 'alarm', payload: { alarm_id: `${cell}-bad-${Date.now()}`, severity: 'warning', code: 'CMD_REJECTED', message: `${name} 거부: 계약에 맞지 않는 명령`, active: true, ...(typeof payload?.cmd_id === 'string' ? { cmd_id: payload.cmd_id } : {}) } });
      }
      return;
    }
    for (const cell of targets) {
      const u = units.get(cell);
      if (!u) continue;
      const r = command(u, name, payload, Date.now());
      if (log) console.log(`[mock] ${cell} ${name} → ${r.accepted ? u.state : '거부'}`);
      sendAll(cell, r.out);
    }
  });

  // HTTP: 영상·멈춘 프레임
  const http = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const [, kind, id] = (req.url ?? '').split('?')[0].split('/');
    if (kind === 'stream' && frames.has(id)) {
      res.writeHead(200, { 'Content-Type': 'image/png', ...cors });
      return res.end(frames.get(id).png);
    }
    if (kind === 'frames') {
      const cell = [...units.values()].find((u) => id?.startsWith(`f-${u.cell}-`))?.cell;
      if (cell) {
        res.writeHead(200, { 'Content-Type': 'image/png', ...cors });
        return res.end(frames.get(cell).png);
      }
    }
    res.writeHead(404, cors);
    res.end('없음');
  });
  await new Promise((r) => http.listen(httpPort, () => r()));

  return {
    site,
    httpPort: http.address().port,
    units,
    /** 정상 종료 */
    close: async () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(metricsTimer);
      http.closeAllConnections();
      await new Promise((r) => http.close(() => r()));
      await Promise.all([...clients.values(), control].map((c) => new Promise((r) => c.end(false, {}, () => r()))));
    },
    /** 비정상 종료(브로커가 유언을 보낸다) */
    kill: () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(metricsTimer);
      http.closeAllConnections();
      http.close();
      for (const c of clients.values()) c.stream.destroy();
      control.stream.destroy();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (flag, fallback) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback);
  const s = await startMockServer({
    site: arg('--site', 'ship-block'),
    url: arg('--url', 'mqtt://localhost:1883'),
    httpPort: Number(arg('--http', 8090)),
    proposeMs: Number(arg('--propose-ms', 1500)),
    log: true,
  });
  console.log(`Mock 서버: ${s.site}, 로봇 ${s.units.size}대, 영상 http://localhost:${s.httpPort}/stream/{cell}`);
  const stop = async () => {
    await s.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
