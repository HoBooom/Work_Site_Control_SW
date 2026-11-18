// shot.sh가 부르는 도구. 검사(check.sh)에는 들어가지 않는다.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { openLab, openRobotLab } from './helpers';

test('장면 한 장 찍기 @shot', async ({ page }) => {
  const raw = process.env.SHOT_QUERY;
  if (!raw) throw new Error('SHOT_QUERY가 없다. digital-twin/harness/shot.sh "<랩 주소 인자>"로 부른다.');
  // "robot?…"이면 로봇 랩(/lab/robot), 아니면 트윈 랩
  const robot = raw.startsWith('robot?');
  const query = robot ? raw.slice('robot?'.length) : raw;
  const q = new URLSearchParams(query);
  if (robot) {
    if (!q.has('panel')) q.set('panel', '0');
  } else {
    if (!q.has('freeze')) q.set('freeze', '1');
    if (!q.has('hud')) q.set('hud', '0');
  }
  const name = (robot ? 'robot_' : '') + query.replace(/[^a-zA-Z0-9=-]+/g, '_').replace(/=/g, '-');
  const lab = robot ? await openRobotLab(page, q.toString()) : await openLab(page, q.toString());
  const dir = new URL('../out/shots/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  // URL.pathname은 한글을 퍼센트 인코딩한 채로 두므로 fileURLToPath로 바꾼다
  const file = fileURLToPath(new URL(`${name}.png`, dir));
  await page.screenshot({ path: file });
  console.log(`SHOT ${file}`);
  if (lab.problems.length) console.log(`콘솔 문제:\n${lab.problems.join('\n')}`);
});
