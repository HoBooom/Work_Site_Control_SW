import type { JointSample } from '../store/twin-store';

/**
 * 렌더 지연(ms). 10Hz 샘플 사이를 보간하려면 한 주기만큼 늦게 그려야 한다.
 * spec DY-01: 지연 150ms 이내.
 */
export const INTERP_DELAY_MS = 100;

/** renderAt 시각의 관절각(deg). 샘플 범위 밖이면 가장 가까운 샘플을 그대로 쓴다. */
export function sampleJoints(samples: readonly JointSample[], renderAt: number): Record<string, number> | null {
  if (!samples.length) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (renderAt <= first.at) return first.joints;
  if (renderAt >= last.at) return last.joints;
  let i = samples.length - 2;
  while (i > 0 && samples[i].at > renderAt) i--;
  const a = samples[i];
  const b = samples[i + 1];
  const span = b.at - a.at;
  if (span <= 0) return b.joints;
  const k = (renderAt - a.at) / span;
  const out: Record<string, number> = { ...b.joints };
  for (const [name, va] of Object.entries(a.joints)) {
    const vb = b.joints[name];
    out[name] = vb === undefined ? va : va + (vb - va) * k;
  }
  return out;
}
