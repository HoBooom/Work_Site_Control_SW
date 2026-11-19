export interface MockServer {
  site: string;
  httpPort: number;
  close(): Promise<void>;
  kill(): void;
}
export function startMockServer(opts?: {
  site?: string;
  url?: string;
  httpPort?: number;
  proposeMs?: number;
  /** Mock 용접 시간(ms, 기본 8000) */
  runMs?: number;
  heartbeatTimeoutMs?: number;
  tickMs?: number;
  log?: boolean;
}): Promise<MockServer>;
