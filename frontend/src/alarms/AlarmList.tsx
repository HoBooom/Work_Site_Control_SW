import { useShallow } from 'zustand/react/shallow';
import type { Alarm, SiteConfig } from '../contracts/messages.gen';
import { SEVERITY_COLOR } from '../scene/cell-view';
import { useSelection } from '../scene/selection';
import { cellKey, useTwinStore } from '../store/twin-store';

const SEVERITY_LABEL = { critical: '치명', warning: '경고', info: '정보' } as const;
const ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** 알람 목록(UI-07): 활성 알람을 심각도순·최신순으로. 누르면 그 로봇을 고른다 */
export function AlarmList({ config }: { config: SiteConfig }) {
  const select = useSelection((s) => s.select);
  // 셀별 알람 레코드를 그대로 고른다(바뀔 때만 참조가 바뀐다). 여기서 새 객체를 만들면 매번 다른 값이 되어 렌더가 끝없이 돈다
  const perCell = useTwinStore(useShallow((s) => config.cells.map((c) => s.cells[cellKey(config.site, c.id)]?.alarms)));
  const rows = config.cells.flatMap((c, i) => Object.values(perCell[i] ?? {}).map((a) => ({ a, cell: c })));
  const sorted = [...rows].sort((x, y) => ORDER[x.a.severity] - ORDER[y.a.severity] || y.a.ts - x.a.ts);
  if (!sorted.length) return <div className="alarm-empty" data-testid="alarm-list" data-count={0}>활성 알람 없음</div>;
  return (
    <div data-testid="alarm-list" data-count={sorted.length}>
      {sorted.map(({ a, cell }) => (
        <button
          key={`${cell.id}/${a.alarm_id}`}
          className="alarm-row"
          data-testid={`alarm-row-${a.alarm_id}`}
          onClick={() => select({ site: config.site, cell: cell.id, kind: 'alarm', id: a.alarm_id })}
        >
          <span className="badge" style={{ background: SEVERITY_COLOR[a.severity as Alarm['severity']], textAlign: 'center' }}>
            {SEVERITY_LABEL[a.severity as keyof typeof SEVERITY_LABEL]}
          </span>
          <span style={{ color: '#6b747d' }}>{new Date(a.ts).toLocaleTimeString('ko-KR', { hour12: false })}</span>
          <strong>{cell.name}</strong>
          <span>{a.message}</span>
        </button>
      ))}
    </div>
  );
}
