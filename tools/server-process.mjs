// 관제 서버(Python, server/)를 자식 프로세스로 띄운다. Mock 서버(tools/mock-server.mjs)와 같은 모양으로 돌려줘
// 같은 L3 검사를 두 서버에 돌린다(frontend/docs/spec.md F5, ADR 0007).
//   close(): SIGTERM → 서버가 offline을 보내고 끊는다.  kill(): SIGKILL → 브로커가 유언(offline)을 보낸다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../server/', import.meta.url));
// uv run을 거치지 않고 가상환경의 python을 바로 띄운다(SIGKILL이 uv가 아니라 서버에 가야 유언이 나간다)
const python = fileURLToPath(new URL('../server/.venv/bin/python', import.meta.url));

/** @param {import('./mock-server.mjs').MockServerOptions} [opts] */
export async function startServer(opts = {}) {
  const { site = 'ship-block', url = 'mqtt://localhost:1883', httpPort = 8090, proposeMs = 1500, runMs, heartbeatTimeoutMs = 3000, fixedMetrics = false, log = false } = opts;
  if (!existsSync(python)) throw new Error('server/.venv가 없다. 저장소 루트에서 `uv sync --project server`를 먼저 한다');
  const args = ['-m', 'app', '--site', site, '--broker', url, '--http', String(httpPort), '--propose-ms', String(proposeMs), '--heartbeat-timeout-ms', String(heartbeatTimeoutMs), '--data', 'none', '--host', '127.0.0.1'];
  if (runMs) args.push('--run-ms', String(runMs));
  if (fixedMetrics) args.push('--fixed-metrics');
  if (!log && !process.env.WELD_SERVER_LOG) args.push('--log', 'warning');
  const child = spawn(python, args, { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'] });
  let errText = '';
  child.stderr.on('data', (d) => {
    errText += d;
    if (log || process.env.WELD_SERVER_LOG) process.stderr.write(d);
  });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /READY http=(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    exited.then(({ code }) => reject(new Error(`서버가 시작하지 못했다(종료 ${code})\n${errText.slice(-2000)}`)));
    setTimeout(() => reject(new Error(`서버가 20초 안에 준비되지 않았다\n${errText.slice(-2000)}`)), 20000);
  });
  return {
    site,
    httpPort: port,
    close: async () => {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGTERM');
      await exited;
    },
    kill: () => {
      child.kill('SIGKILL');
    },
  };
}
