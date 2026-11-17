import { describe, expect, it } from 'vitest';
import { FixturePlayer, parseFixture } from './fixture';

const line = (t: number, topic = 'a') => JSON.stringify({ t, topic, payload: { t } });

describe('parseFixture', () => {
  it('빈 줄을 건너뛰고 읽는다', () => {
    const lines = parseFixture([line(0), '', line(10), ''].join('\n'));
    expect(lines.map((l) => l.t)).toEqual([0, 10]);
  });

  it('JSON이 아니면 줄 번호와 함께 실패한다', () => {
    expect(() => parseFixture([line(0), '{bad'].join('\n'), 'x.jsonl')).toThrow('x.jsonl:2');
  });

  it('필드가 빠지면 실패한다', () => {
    expect(() => parseFixture('{"t":0,"topic":"a"}')).toThrow('payload');
  });

  it('t가 줄어들면 실패한다', () => {
    expect(() => parseFixture([line(10), line(5)].join('\n'))).toThrow('줄어든다');
  });
});

describe('FixturePlayer', () => {
  const lines = parseFixture([0, 100, 100, 200, 300].map((t, i) => line(t, `m${i}`)).join('\n'));

  function make() {
    const applied: string[] = [];
    let resets = 0;
    const player = new FixturePlayer(lines, {
      apply: (topic) => applied.push(topic),
      reset: () => {
        applied.length = 0;
        resets++;
      },
    });
    return { player, applied, resets: () => resets };
  }

  it('그 시각까지의 메시지를 반영한다(경계 포함)', () => {
    const { player, applied } = make();
    player.seek(100);
    expect(applied).toEqual(['m0', 'm1', 'm2']);
    player.seek(250);
    expect(applied).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('뒤로 가면 비우고 처음부터 다시 반영한다', () => {
    const { player, applied, resets } = make();
    player.seek(300);
    player.seek(0);
    expect(resets()).toBe(1);
    expect(applied).toEqual(['m0']);
  });

  it('같은 시각은 같은 결과다', () => {
    const a = make();
    a.player.seek(200);
    const b = make();
    b.player.seek(50);
    b.player.seek(300);
    b.player.seek(200);
    expect(b.applied).toEqual(a.applied);
  });

  it('duration은 마지막 메시지 시각이다', () => {
    expect(make().player.duration).toBe(300);
  });
});
