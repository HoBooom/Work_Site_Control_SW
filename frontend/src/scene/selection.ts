import { create } from 'zustand';

/** IX-02 선택 이벤트. 사이드 패널(M5)이 이것을 받아 해당 셀을 연다 */
export interface Selection {
  site: string;
  cell: string;
  kind: 'robot' | 'alarm';
  /** robot이면 셀 id, alarm이면 alarm_id */
  id: string;
}

interface SelectionStore {
  selected: Selection | null;
  select: (s: Selection | null) => void;
}

export const useSelection = create<SelectionStore>((set) => ({
  selected: null,
  select: (selected) => set({ selected }),
}));

export const isSame = (a: Selection | null, b: Selection | null) =>
  !!a && !!b && a.site === b.site && a.cell === b.cell && a.kind === b.kind && a.id === b.id;

/** 누른 뒤 이만큼(px) 넘게 끌면 카메라 조작으로 보고 선택하지 않는다 */
export const CLICK_MAX_DRAG_PX = 4;
