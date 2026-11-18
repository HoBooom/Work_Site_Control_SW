import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Vector3 } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { clampToBounds, siteBounds } from './bounds';
import { CAMERA_MAX_DISTANCE_M, CAMERA_MAX_POLAR_DEG, CAMERA_MIN_DISTANCE_M, PRESET_TRANSITION_MS } from './camera-limits';
import { deg, siteToScene, type V3 } from './frame';

const sceneToSite = ([x, y, z]: V3): V3 => [x, -z, y];
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

interface Props {
  config: SiteConfig;
  preset: string;
}

interface Transition {
  fromPos: Vector3;
  fromTarget: Vector3;
  toPos: Vector3;
  toTarget: Vector3;
  elapsed: number;
}

/**
 * IX-01: 마우스·터치 궤도 카메라. 바닥 아래로 내려가지 않고(극각 제한), 거리 제한이 있고,
 * 목표점은 사이트 영역 밖으로 나가지 않는다(벗어나면 카메라와 함께 되돌린다).
 * IX-03: 프리셋이 바뀌면 지금 위치에서 부드럽게 옮긴다. 옮기는 중에 또 바뀌어도 그 자리에서 다시 출발한다.
 * 전환은 사용자 조작 연출이라 가상 시계가 아니라 실제 프레임 시간으로 움직인다(harness.md 결정성 규칙의 예외).
 */
export function CameraControls({ config, preset }: Props) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const bounds = useMemo(() => siteBounds(config), [config]);
  const transition = useRef<Transition | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const p = config.presets.find((x) => x.id === preset);
    const c = controls.current;
    if (!p || !c) return;
    const toPos = new Vector3(...siteToScene(p.eye_m));
    const toTarget = new Vector3(...siteToScene(p.target_m));
    if (first.current) {
      // 첫 프리셋은 바로 놓는다(스크린샷·테스트가 주소 인자로 고정한 장면)
      first.current = false;
      camera.position.copy(toPos);
      c.target.copy(toTarget);
      c.update();
      return;
    }
    transition.current = { fromPos: camera.position.clone(), fromTarget: c.target.clone(), toPos, toTarget, elapsed: 0 };
  }, [camera, config, preset]);

  useFrame((_, delta) => {
    const tr = transition.current;
    const c = controls.current;
    if (!tr || !c) return;
    tr.elapsed += delta * 1000;
    const k = easeInOut(Math.min(1, tr.elapsed / PRESET_TRANSITION_MS));
    camera.position.lerpVectors(tr.fromPos, tr.toPos, k);
    c.target.lerpVectors(tr.fromTarget, tr.toTarget, k);
    c.update();
    if (k >= 1) transition.current = null;
  });

  const keepInside = () => {
    const c = controls.current;
    if (!c || transition.current) return;
    const t = sceneToSite([c.target.x, c.target.y, c.target.z]);
    const clamped = clampToBounds(t, bounds);
    if (clamped.every((v, i) => v === t[i])) return;
    const [x, y, z] = siteToScene(clamped);
    const dx = x - c.target.x;
    const dy = y - c.target.y;
    const dz = z - c.target.z;
    c.target.set(x, y, z);
    camera.position.set(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
  };

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      minDistance={CAMERA_MIN_DISTANCE_M}
      maxDistance={CAMERA_MAX_DISTANCE_M}
      maxPolarAngle={deg(CAMERA_MAX_POLAR_DEG)}
      onChange={keepInside}
    />
  );
}
