import { useShallow } from 'zustand/react/shallow';
import type { Alarm, SiteConfig } from '../contracts/messages.gen';
import { SEVERITY_UI } from '../panel/ui-state';
import { useSelection } from '../scene/selection';
import { cellKey, useTwinStore } from '../store/twin-store';

const ORDER = { critical: 0, warning: 1, info: 2 } as const;

export interface AlarmRow {
  a: Alarm;
  cell: SiteConfig['cells'][number];
}

/** 활성 알람을 심각도순·최신순으로. 셀별 알람 레코드를 그대로 골라(바뀔 때만 참조가 바뀐다) 렌더가 끝없이 돌지 않게 한다 */
export function useAlarmRows(config: SiteConfig): AlarmRow[] {
  const perCell = useTwinStore(useShallow((s) => config.cells.map((c) => s.cells[cellKey(config.site, c.id)]?.alarms)));
  const rows = config.cells.flatMap((c, i) => Object.values(perCell[i] ?? {}).map((a) => ({ a, cell: c })));
  return rows.sort((x, y) => ORDER[x.a.severity] - ORDER[y.a.severity] || y.a.ts - x.a.ts);
}

/** 알람 카드(UI-07): 트윈 왼쪽 위에 뜬다. 누르면 그 로봇을 고른다. 하단 독의 알람 버튼으로 열고 닫는다 */
export function AlarmCard({ config, rows, onClose }: { config: SiteConfig; rows: AlarmRow[]; onClose: () => void }) {
  const select = useSelection((s) => s.select);
  return (
    <div className="alarm-card" data-testid="app-alarms">
      <div className="alarm-card-head">
        <span>알람 {rows.length}건</span>
        <button className="alarm-close" aria-label="알람 닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="alarm-card-body" data-testid="alarm-list" data-count={rows.length}>
        {rows.length === 0 && <div className="alarm-empty">활성 알람 없음</div>}
        {rows.map(({ a, cell }) => {
          const sev = SEVERITY_UI[a.severity];
          return (
            <button
              key={`${cell.id}/${a.alarm_id}`}
              className="alarm-row"
              data-testid={`alarm-row-${a.alarm_id}`}
              onClick={() => select({ site: config.site, cell: cell.id, kind: 'alarm', id: a.alarm_id })}
            >
              <span className="sev" style={{ background: sev.bg, color: sev.fg }}>
                {sev.label}
              </span>
              <span className="alarm-text">
                <span className="alarm-who">
                  {cell.name} <span className="alarm-time">{new Date(a.ts).toLocaleTimeString('ko-KR', { hour12: false })}</span>
                </span>
                <span className="alarm-msg">{a.message}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
