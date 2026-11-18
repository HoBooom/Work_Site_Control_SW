import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3, type Group } from 'three';
import type { V3 } from '../frame';

export interface DomLabelContent {
  /** 앞의 색 점 */
  dot?: string;
  bold?: string;
  text: string;
}

interface Props {
  /** 부모 그룹 좌표계 기준 위치 */
  position: V3;
  content: DomLabelContent;
  testId: string;
  /** data-* 속성 */
  dataset?: Record<string, string>;
  variant?: 'label' | 'badge';
}

const v = new Vector3();

/**
 * 3D 위치를 따라다니는 DOM 라벨(IX-04, DY-09 표시).
 * drei Html은 라벨마다 React 루트를 따로 만들어, Canvas를 다시 만들 때(사이트·품질 전환) 렌더 중 동기 unmount 오류를 낸다.
 * 여기서는 React 루트 없이 요소 하나를 직접 만들고, 매 프레임 화면 좌표로 옮긴다.
 */
export function DomLabel({ position, content, testId, dataset, variant = 'label' }: Props) {
  const anchor = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const el = useMemo(() => {
    const d = document.createElement('div');
    Object.assign(d.style, variant === 'label' ? labelStyle : badgeStyle, baseStyle);
    return d;
  }, [variant]);

  useEffect(() => {
    const host = gl.domElement.parentElement;
    host?.appendChild(el);
    return () => el.remove();
  }, [gl, el]);

  useEffect(() => {
    el.dataset.testid = testId;
    for (const [k, val] of Object.entries(dataset ?? {})) el.dataset[k] = val;
    el.replaceChildren();
    if (content.dot) {
      const dot = document.createElement('span');
      Object.assign(dot.style, dotStyle, { background: content.dot });
      el.append(dot);
    }
    if (content.bold) {
      const b = document.createElement('b');
      b.textContent = content.bold;
      el.append(b);
    }
    const t = document.createElement('span');
    t.textContent = content.text;
    if (content.bold) t.style.opacity = '0.8';
    el.append(t);
  }, [el, testId, dataset, content.dot, content.bold, content.text]);

  useFrame(() => {
    const a = anchor.current;
    if (!a) return;
    a.getWorldPosition(v).project(camera);
    const hidden = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
    el.style.display = hidden ? 'none' : 'flex';
    if (hidden) return;
    const x = ((v.x + 1) / 2) * size.width;
    const y = ((1 - v.y) / 2) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  });

  return <group ref={anchor} position={position} />;
}

const baseStyle: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '0',
  top: '0',
  zIndex: '10',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  alignItems: 'center',
  gap: '6px',
  font: '12px/1.3 system-ui, sans-serif',
  borderRadius: '4px',
};
const labelStyle: Partial<CSSStyleDeclaration> = {
  padding: '3px 8px',
  color: '#1d2228',
  background: 'rgba(255,255,255,0.88)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
};
const badgeStyle: Partial<CSSStyleDeclaration> = {
  padding: '2px 8px',
  color: '#fff',
  background: 'rgba(110,118,129,0.95)',
};
const dotStyle: Partial<CSSStyleDeclaration> = { width: '8px', height: '8px', borderRadius: '4px', display: 'inline-block' };
