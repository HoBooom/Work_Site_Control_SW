export interface FixtureLine {
  t: number;
  topic: string;
  payload: Record<string, unknown>;
}
export interface Playback {
  sent: number;
  /** 정상 종료(유언 없음) */
  end(): Promise<void>;
  /** 소켓을 끊어 비정상 종료를 흉내 낸다(브로커가 유언 status=offline을 보낸다) */
  kill(): void;
}
export function readFixture(name: string): FixtureLine[];
export function playFixture(
  lines: FixtureLine[],
  opts?: { url?: string; speed?: number; until?: number; instant?: boolean; keepTs?: boolean; clear?: boolean; signal?: AbortSignal },
): Promise<Playback>;
