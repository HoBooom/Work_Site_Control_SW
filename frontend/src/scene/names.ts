/** 씬 객체 이름. 디버그 API와 테스트가 이 이름으로 객체를 찾는다. */
export type ScenePart = 'cell' | 'plate' | 'robot' | 'seam' | 'lamp' | 'arc';

export const objectName = (part: ScenePart, site: string, cell: string) => `${part}:${site}/${cell}`;
export const alarmName = (site: string, cell: string, alarmId: string) => `alarm:${site}/${cell}/${alarmId}`;
/** DOM(Html) 요소의 data-testid */
export const labelTestId = (site: string, cell: string) => `cell-label-${site}-${cell}`;
export const staleTestId = (site: string, cell: string) => `robot-stale-${site}-${cell}`;
