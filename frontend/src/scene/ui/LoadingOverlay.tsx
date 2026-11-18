import { useProgress } from '@react-three/drei';

/** RD-01: 에셋 로딩 진행률. Canvas 바깥(DOM)에 둔다. */
export function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div role="status" data-testid="scene-loading" style={style}>
      3D 장면 불러오는 중 {Math.round(progress)}%
    </div>
  );
}

const style: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '8px 14px',
  font: '14px/1.4 system-ui, sans-serif',
  color: '#1d2228',
  background: 'rgba(255,255,255,0.85)',
  borderRadius: 6,
};
