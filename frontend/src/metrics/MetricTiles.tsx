import type { CellState } from '../store/twin-store';

/** 비전 메트릭 칸(UI-09): 신뢰도(제안), 추론 지연·외란 강도(vision/metrics). 값이 없으면 – */
export function MetricTiles({ cell }: { cell: CellState | undefined }) {
  const confidence = cell?.proposal ? Math.round((cell.proposal.confidence ?? 0) * 100) : null;
  const m = cell?.metrics;
  return (
    <div className="tiles">
      <Tile label="신뢰도" testId="unit-confidence" value={confidence} unit="%" />
      <Tile label="추론 지연" testId="unit-latency" value={m ? Math.round(m.latency_ms) : null} unit="ms" />
      <Tile label="외란 강도" testId="unit-disturbance" value={m ? Math.round(m.disturbance * 100) : null} unit="%" />
    </div>
  );
}

function Tile({ label, testId, value, unit }: { label: string; testId: string; value: number | null; unit: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value" data-testid={testId}>
        {value ?? '–'}
        <span className="tile-unit">{unit}</span>
      </div>
    </div>
  );
}
