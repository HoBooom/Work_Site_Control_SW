import { expect, type ConsoleMessage, type Page } from '@playwright/test';

export interface LabSession {
  /** 콘솔 오류·경고와 페이지 예외. 테스트 끝에 expectClean()으로 0건을 확인한다. */
  problems: string[];
  expectClean(): void;
}

/** 무시할 콘솔 메시지. 우리 코드와 상관없는 것만 넣고, 넣을 때는 이유를 적는다. */
const IGNORED: RegExp[] = [
  /Download the React DevTools/, // React 개발 모드 안내
  // @react-three/fiber 9.8 내부가 THREE.Clock을 쓴다(three 0.187에서 폐기 경고). 우리 코드는 Clock을 쓰지 않는다.
  // R3F가 THREE.Timer로 바꾸면 지운다.
  /THREE\.Clock: This module has been deprecated/,
];

/** 트윈 랩을 열고 ready()까지 기다린다. */
export async function openLab(page: Page, query: string): Promise<LabSession> {
  const problems: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (IGNORED.some((re) => re.test(m.text()))) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

  await page.goto(`/lab?${query}`);
  await page.waitForFunction(() => !!window.__twin);
  await page.evaluate(() => window.__twin!.ready());
  return {
    problems,
    expectClean: () => expect(problems, '콘솔 오류·경고가 없어야 한다').toEqual([]),
  };
}

/** shots.json의 장면 하나를 랩 주소 인자로 바꾼다. 스크린샷에는 HUD를 넣지 않는다. */
export interface Shot {
  site: string;
  fixture: string;
  t: number;
  preset: string;
  quality: 'high' | 'low';
}

export const shotName = (s: Shot) => `${s.site}-${s.fixture}-${s.t}-${s.preset}-${s.quality}`;

export const shotQuery = (s: Shot) =>
  new URLSearchParams({
    site: s.site,
    fixture: s.fixture,
    t: String(s.t),
    preset: s.preset,
    quality: s.quality,
    freeze: '1',
    hud: '0',
  }).toString();
