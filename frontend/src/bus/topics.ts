import {
  CELL_TOPIC_SUFFIXES,
  TOPIC_PREFIX,
  type CellTopicPayloads,
  type CellTopicSuffix,
} from '../contracts/messages.gen';

export interface CellTopic {
  site: string;
  cell: string;
  suffix: CellTopicSuffix;
}

const SUFFIXES = new Set<string>(CELL_TOPIC_SUFFIXES);

/** `innoworks/{site}/{cell}/{suffix}`를 나눈다. 셀 토픽이 아니면 null. */
export function parseCellTopic(topic: string): CellTopic | null {
  const parts = topic.split('/');
  if (parts.length < 4 || parts[0] !== TOPIC_PREFIX) return null;
  const [, site, cell, ...rest] = parts;
  const suffix = rest.join('/');
  if (!site || !cell || !SUFFIXES.has(suffix)) return null;
  return { site, cell, suffix: suffix as CellTopicSuffix };
}

export function cellTopic<S extends CellTopicSuffix>(site: string, cell: string, suffix: S): string {
  return `${TOPIC_PREFIX}/${site}/${cell}/${suffix}`;
}

export type { CellTopicPayloads };
