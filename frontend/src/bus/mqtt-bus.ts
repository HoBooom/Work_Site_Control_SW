import mqtt, { type MqttClient } from 'mqtt';
import { TOPIC_PREFIX } from '../contracts/messages.gen';
import { parseCellTopic } from './topics';
import { validatePayload } from './validate';

const NOTIFY_MS = 250;

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

export interface Bus {
  stats(): BusStats;
  close(): Promise<void>;
}

interface Options {
  /** 브로커 웹소켓 주소(ws://host:9001) */
  url: string;
  site: string;
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
export function connectBus({ url, site, apply, now, onChange }: Options): Bus {
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
  return {
    stats: () => ({ ...stats }),
    close: () =>
      new Promise<void>((resolve) => {
        stats.state = 'closed';
        if (pending) clearTimeout(pending);
        client.end(true, {}, () => resolve());
      }),
  };
}
