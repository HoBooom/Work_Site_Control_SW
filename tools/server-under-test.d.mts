export type { MockServer } from './mock-server.mjs';
import type { MockServer, MockServerOptions } from './mock-server.mjs';
export const serverKind: 'python' | 'mock';
export function startMockServer(opts?: MockServerOptions): Promise<MockServer>;
