import mqtt, { type MqttClient } from 'mqtt';
import { TOPIC_PREFIX } from '../contracts/messages.gen';
import { parseCellTopic } from './topics';
import { validateCommand, validatePayload } from './validate';
import type { CommandPayloads, CommandSuffix } from '../contracts/messages.gen';

const NOTIFY_MS = 250;

/** 명령 id. randomUUID는 보안 컨텍스트(https, localhost)에만 있다: 현장 LAN의 http 태블릿에서는 대체 값 */
const newId = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `c-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export type BusState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface BusStats {
  url: string;
  state: BusState;
  /** store에 넣은 메시지 수 */
  received: number;
  /** 형식이 틀려 버린 메시지 수 */
  dropped: number;
  lastError: string | null;
}

/** 명령 공통 필드(v, ts, cmd_id, operator)는 bus가 붙인다 */
type CommandBody<S extends CommandSuffix> = Omit<CommandPayloads[S], 'v' | 'ts' | 'cmd_id' | 'operator'>;

export interface Bus {
  stats(): BusStats;
  close(): Promise<void>;
  /**
   * 명령을 보낸다(웹→서버). cell이 null이면 사이트 토픽(모든 로봇). 계약으로 먼저 검사하고, 어기면 예외.
   * 화면은 바꾸지 않는다: 결과는 서버가 보내는 task/state로 온다(frontend 핵심 규칙). cmd_id를 돌려준다.
   */
  command<S extends CommandSuffix>(cell: string | null, suffix: S, body: CommandBody<S>): string;
  /** 운영자 heartbeat(1초마다 부른다) */
  heartbeat(): void;
}

interface Options {
  /** 브로커 웹소켓 주소(ws://host:9001) */
  url: string;
  site: string;
  /** 운영자 id(로그인 전에는 브라우저마다 만든 값). 명령·heartbeat에 넣는다 */
  operator?: string;
  /** store에 넣는다. at = 수신 시각(now) */
  apply: (topic: string, payload: unknown, at: number) => boolean;
  now: () => number;
  onChange?: (s: BusStats) => void;
}

/** 기본 브로커 주소: 웹을 연 호스트의 9001(엣지에서 웹과 브로커가 같은 장비) */
export const defaultBrokerUrl = () => `ws://${window.location.hostname || 'localhost'}:9001`;

/**
 * M5: MQTT 브로커 → store. 픽스처 재생기 자리를 대신한다(씬은 그대로).
 * `innoworks/{site}/#`를 구독하고, 셀 토픽 payload를 계약 스키마로 검사해 맞는 것만 store에 넣는다(contracts "검증은 받는 쪽").
 * 끊기면 1초마다 다시 붙는다. retained 메시지가 다시 와서 상태가 복구된다(DY-08).
 */
export function connectBus({ url, site, operator = 'op-anon', apply, now, onChange }: Options): Bus {
  const stats: BusStats = { url, state: 'connecting', received: 0, dropped: 0, lastError: null };
  const changed = () => onChange?.({ ...stats });
  // 받은 수는 메시지마다가 아니라 0.25초에 한 번 몰아서 알린다(화면을 메시지마다 다시 그리지 않게)
  let pending: ReturnType<typeof setTimeout> | null = null;
  const changedSoon = () => {
    if (!onChange || pending) return;
    pending = setTimeout(() => {
      pending = null;
      changed();
    }, NOTIFY_MS);
  };
  const client: MqttClient = mqtt.connect(url, {
    clientId: `twin-web-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 1000,
    connectTimeout: 5000,
    clean: true,
  });
  client.on('connect', () => {
    stats.state = 'connected';
    client.subscribe(`${TOPIC_PREFIX}/${site}/#`, { qos: 1 });
    changed();
  });
  client.on('reconnect', () => {
    stats.state = 'reconnecting';
    changed();
  });
  client.on('close', () => {
    if (stats.state !== 'closed') stats.state = 'reconnecting';
    changed();
  });
  client.on('error', (e) => {
    stats.lastError = e.message;
    changed();
  });
  client.on('message', (topic, buf) => {
    if (!buf.length) return; // retained 비우기
    const t = parseCellTopic(topic);
    if (!t) return;
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      payload = undefined;
    }
    const err = payload === undefined ? 'JSON이 아니다' : validatePayload(t.suffix, payload);
    if (err) {
      stats.dropped++;
      console.warn(`[bus] ${topic}: ${err} → 버림`);
      changed();
      return;
    }
    apply(topic, payload, now());
    stats.received++;
    changedSoon();
  });
  const clientId = `twin-web-${Math.random().toString(16).slice(2, 10)}`;
  return {
    stats: () => ({ ...stats }),
    command: (cell, suffix, body) => {
      const cmd_id = newId();
      const payload = { v: 1, ts: Date.now(), cmd_id, operator, ...body };
      const err = validateCommand(suffix, payload);
      if (err) throw new Error(`계약에 맞지 않는 명령: ${err}`);
      const topic = cell ? `${TOPIC_PREFIX}/${site}/${cell}/${suffix}` : `${TOPIC_PREFIX}/${site}/${suffix}`;
      client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false });
      return cmd_id;
    },
    heartbeat: () => {
      if (stats.state !== 'connected') return;
      client.publish(`${TOPIC_PREFIX}/operator/${clientId}/heartbeat`, JSON.stringify({ v: 1, ts: Date.now(), site, operator }), { qos: 0 });
    },
    close: () =>
      new Promise<void>((resolve) => {
        stats.state = 'closed';
        if (pending) clearTimeout(pending);
        client.end(true, {}, () => resolve());
      }),
  };
}
