import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PMREMGenerator, type DirectionalLight } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SiteConfig } from '../contracts/messages.gen';
import { siteBounds } from './bounds';
import { siteToScene } from './frame';
import type { QualitySettings } from './quality';

export const BACKGROUND = '#cfd4da';
/** 바닥이 사이트 경계 밖에서 자연스럽게 사라지도록(spec 2절 배경) */
const FOG_NEAR_M = 22;
const FOG_FAR_M = 60;
const ENV_INTENSITY = 0.45;
const KEY_INTENSITY = 2.2;
/** 키 라이트 방향(사이트 좌표, 정규화 전). 왼쪽 앞 위에서 */
const KEY_DIR: [number, number, number] = [-0.5, -0.7, 1];
const SHADOW_MARGIN_M = 2;

interface Props {
  config: SiteConfig;
  quality: QualitySettings;
}

/**
 * RD-02 환경광·키 라이트, RD-03 그림자.
 * 환경광: three RoomEnvironment(절차적 실내 환경)를 PMREM으로 굽는다. 외부 HDRI 파일이 필요 없어 엣지(Jetson)에서도 오프라인으로 돈다.
 * 키 라이트 그림자 범위는 사이트 영역에 맞춘다.
 */
export function Lighting({ config, quality }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const light = useRef<DirectionalLight>(null);
  const bounds = useMemo(() => siteBounds(config, SHADOW_MARGIN_M), [config]);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = ENV_INTENSITY;
    room.dispose();
    pmrem.dispose();
    return () => {
      if (scene.environment === env) scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);

  // 사이트 중심을 겨누고, 사이트 영역을 덮는 직교 그림자 카메라
  const { target, position, half } = useMemo(() => {
    const c: [number, number, number] = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      0,
    ];
    const len = Math.hypot(...KEY_DIR);
    const dist = 30;
    const p: [number, number, number] = [
      c[0] + (KEY_DIR[0] / len) * dist,
      c[1] + (KEY_DIR[1] / len) * dist,
      (KEY_DIR[2] / len) * dist,
    ];
    const h = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) / 2;
    return { target: siteToScene(c), position: siteToScene(p), half: h };
  }, [bounds]);

  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(...target);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 70;
    cam.updateProjectionMatrix();
  }, [target, half]);

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, FOG_NEAR_M, FOG_FAR_M]} />
      <hemisphereLight args={['#ffffff', '#6b7076', 0.2]} />
      <directionalLight
        ref={light}
        name="key-light"
        position={position}
        intensity={KEY_INTENSITY}
        castShadow
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={quality.shadowRadius}
      />
    </>
  );
}
