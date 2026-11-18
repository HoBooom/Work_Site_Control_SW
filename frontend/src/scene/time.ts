import { createContext, useContext } from 'react';

/** 씬의 "지금"(ms). store.apply에 넘기는 수신 시각과 같은 시계여야 한다. 랩은 가상 시계를 넣는다. */
export type NowFn = () => number;

export const TwinTimeContext = createContext<NowFn>(() => performance.now());

export const useTwinNow = () => useContext(TwinTimeContext);
