// 개발·검사용 MQTT 브로커(aedes). 엣지(MIC-711D)에서는 mosquitto를 쓴다(infra/mosquitto.conf, ADR 0004).
//   node infra/broker.mjs [--tcp 1883] [--ws 9001] [--log]
// 포트는 mosquitto 설정과 같다: TCP 1883(서버·도구), 웹소켓 9001(브라우저).
// 검사(harness/e2e/mqtt.spec.ts)는 startBroker({ tcpPort: 0, wsPort: 0 })로 빈 포트에 띄운다.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    // 호스트를 주지 않으면 IPv4·IPv6 모두에서 받는다(브라우저의 localhost가 ::1일 수 있다)
    server.listen(port, () => resolve(server.address().port));
  });

/**
 * @param {{ tcpPort?: number, wsPort?: number, log?: boolean }} [opts]
 * @returns {Promise<{ tcpPort: number, wsPort: number, close: () => Promise<void> }>}
 */
export async function startBroker({ tcpPort = 1883, wsPort = 9001, log = false } = {}) {
  const aedes = await Aedes.createBroker();
  const tcp = createTcpServer(aedes.handle);
  const sockets = new Set();
  tcp.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socket) => aedes.handle(createWebSocketStream(socket)));
  if (log) {
    aedes.on('client', (c) => console.log(`[broker] 연결 ${c.id}`));
    aedes.on('clientDisconnect', (c) => console.log(`[broker] 끊김 ${c.id}`));
  }
  const ports = { tcpPort: await listen(tcp, tcpPort), wsPort: await listen(http, wsPort) };
  return {
    ...ports,
    close: async () => {
      // 남은 연결을 끊어야 서버가 닫힌다(정리하지 않은 클라이언트가 있어도 멈추지 않게)
      for (const c of wss.clients) c.terminate();
      for (const s of sockets) s.destroy();
      http.closeAllConnections();
      await new Promise((r) => wss.close(() => r()));
      await new Promise((r) => http.close(() => r()));
      await new Promise((r) => tcp.close(() => r()));
      await new Promise((r) => aedes.close(() => r()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : fallback;
  };
  const b = await startBroker({ tcpPort: arg('--tcp', 1883), wsPort: arg('--ws', 9001), log: process.argv.includes('--log') });
  console.log(`MQTT 브로커(aedes): tcp://localhost:${b.tcpPort}, ws://localhost:${b.wsPort}`);
  const stop = async () => {
    await b.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
