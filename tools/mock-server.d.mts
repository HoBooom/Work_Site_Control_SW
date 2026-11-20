export interface MockServer {
  site: string;
  httpPort: number;
  close(): Promise<void>;
  kill(): void;
}
export interface MockServerOptions {
  site?: string;
  url?: string;
  httpPort?: number;
  proposeMs?: number;
  /** Mock 용접 시간(ms, 기본 8000) */
  runMs?: number;
  heartbeatTimeoutMs?: number;
  tickMs?: number;
  /** 메트릭을 고정값(지연 70ms, 외란 12%)으로 보낸다. 기준 화면용 */
  fixedMetrics?: boolean;
  log?: boolean;
}
export function startMockServer(opts?: MockServerOptions): Promise<MockServer>;
