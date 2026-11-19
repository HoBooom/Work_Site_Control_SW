import { createContext, useContext } from 'react';
import type { Bus } from '../bus/mqtt-bus';

/** 관제 화면의 bus. 패널·알람이 명령을 보낼 때 쓴다(화면 컴포넌트는 MQTT를 직접 만지지 않는다) */
export const BusContext = createContext<Bus | null>(null);
export const useBus = () => useContext(BusContext);

/** 영상 주소 앞부분. 비어 있으면 같은 출처(개발 서버가 Mock 서버로 넘긴다) */
export const MediaContext = createContext('');
export const useMedia = () => useContext(MediaContext);
