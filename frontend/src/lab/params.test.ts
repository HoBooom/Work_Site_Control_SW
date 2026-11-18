import { describe, expect, it } from 'vitest';
import { parseLabParams } from './params';

describe('parseLabParams', () => {
  it('기본값', () => {
    expect(parseLabParams('')).toEqual({
      site: null,
      fixture: 'idle',
      t: 0,
      preset: null,
      quality: null,
      freeze: false,
      hud: true,
    });
  });

  it('모든 인자를 읽는다', () => {
    expect(
      parseLabParams('?site=shipyard&fixture=weld-basic&t=3200&preset=cell-1&quality=low&freeze=1&hud=0'),
    ).toEqual({
      site: 'shipyard',
      fixture: 'weld-basic',
      t: 3200,
      preset: 'cell-1',
      quality: 'low',
      freeze: true,
      hud: false,
    });
  });

  it('잘못된 값은 거부한다', () => {
    expect(() => parseLabParams('?t=-1')).toThrow();
    expect(() => parseLabParams('?t=abc')).toThrow();
    expect(() => parseLabParams('?quality=ultra')).toThrow();
  });
});
