// shot.sh가 부르는 도구. 검사(check.sh)에는 들어가지 않는다.
import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { openLab } from './helpers';

test('장면 한 장 찍기 @shot', async ({ page }) => {
  const query = process.env.SHOT_QUERY;
  if (!query) throw new Error('SHOT_QUERY가 없다. digital-twin/harness/shot.sh "<랩 주소 인자>"로 부른다.');
  const q = new URLSearchParams(query);
  if (!q.has('freeze')) q.set('freeze', '1');
  if (!q.has('hud')) q.set('hud', '0');
  const name = query.replace(/[^a-zA-Z0-9=-]+/g, '_').replace(/=/g, '-');
  const lab = await openLab(page, q.toString());
  const dir = new URL('../out/shots/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${name}.png`, dir);
  await page.screenshot({ path: file.pathname });
  console.log(`SHOT ${decodeURIComponent(file.pathname)}`);
  if (lab.problems.length) console.log(`콘솔 문제:\n${lab.problems.join('\n')}`);
});
