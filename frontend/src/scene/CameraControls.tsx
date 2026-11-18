import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Vector3 } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { clampToBounds, siteBounds } from './bounds';
import { CAMERA_MAX_DISTANCE_M, CAMERA_MAX_POLAR_DEG, CAMERA_MIN_DISTANCE_M, PRESET_TRANSITION_MS } from './camera-limits';
import { deg, siteToScene, type V3 } from './frame';
import { objectName } from './names';
import { useSelection } from './selection';

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
 * IX-07: 로봇을 선택하면 카메라와 목표점이 로봇이 움직인 만큼 같이 옮겨 간다(튀지 않고, 궤도 조작은 그대로).
 * 고정 로봇은 움직이지 않으므로 아무 일도 없다. 선택을 풀면 멈춘다. 따라가는 대상은 scene.userData.follow(디버그 API).
 */
export function CameraControls({ config, preset }: Props) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const bounds = useMemo(() => siteBounds(config), [config]);
  const transition = useRef<Transition | null>(null);
  const first = useRef(true);
  const scene = useThree((s) => s.scene);
  const followed = useRef<{ name: string; last: Vector3 } | null>(null);

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

  useFrame(() => {
    const c = controls.current;
    const sel = useSelection.getState().selected;
    const robot = sel?.kind === 'robot' && sel.site === config.site ? scene.getObjectByName(objectName('robot', sel.site, sel.cell)) : undefined;
    if (!robot || !c) {
      followed.current = null;
      scene.userData.follow = null;
      return;
    }
    const now = robot.getWorldPosition(new Vector3());
    const f = followed.current;
    if (f?.name === robot.name) {
      const d = now.clone().sub(f.last);
      const tr = transition.current;
      if (d.lengthSq() > 0) {
        if (tr) {
          // 프리셋 전환 중이면 전환의 시작·끝을 같이 옮긴다(움직임을 잃지 않게)
          [tr.fromPos, tr.fromTarget, tr.toPos, tr.toTarget].forEach((v) => v.add(d));
        } else {
          camera.position.add(d);
          c.target.add(d);
          c.update();
        }
      }
    }
    followed.current = { name: robot.name, last: now };
    scene.userData.follow = { site: sel!.site, cell: sel!.cell };
  });

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
