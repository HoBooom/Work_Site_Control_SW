// 검사가 띄울 서버를 고른다. WELD_SERVER=python이면 관제 서버(server/), 아니면 Node Mock 서버.
// check.sh가 L3 관제 검사를 두 서버에 한 번씩 돌린다.
import { startMockServer as startNodeMock } from './mock-server.mjs';
import { startServer as startPython } from './server-process.mjs';

export const serverKind = process.env.WELD_SERVER === 'python' ? 'python' : 'mock';
/** @type {typeof startNodeMock} */
export const startMockServer = serverKind === 'python' ? startPython : startNodeMock;
