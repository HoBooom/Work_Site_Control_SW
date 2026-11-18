export interface Broker {
  tcpPort: number;
  wsPort: number;
  close(): Promise<void>;
}
export function startBroker(opts?: { tcpPort?: number; wsPort?: number; log?: boolean }): Promise<Broker>;
