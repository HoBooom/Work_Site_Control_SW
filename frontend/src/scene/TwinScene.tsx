import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { SiteConfig } from '../contracts/messages.gen';
import { SITE_TO_SCENE_ROTATION_X, deg, siteToScene } from './frame';

const GROUND_SIZE_M = 60;

interface Props {
  config: SiteConfig;
  /** 카메라 프리셋 id */
  preset: string;
}

/** 씬의 입구. site-config와 store만 읽는다(spec 3절). */
export function TwinScene({ config, preset }: Props) {
  return (
    <>
      <color attach="background" args={['#d9dde2']} />
      <hemisphereLight args={['#ffffff', '#8a8f96', 1.2]} />
      <directionalLight position={[8, 12, 6]} intensity={2} />
      <CameraRig config={config} preset={preset} />
      <gridHelper args={[GROUND_SIZE_M, GROUND_SIZE_M, '#9aa1aa', '#b9bec5']} position={[0, 0.001, 0]} />
      <group name={`site:${config.site}`} rotation-x={SITE_TO_SCENE_ROTATION_X}>
        <mesh name="ground" receiveShadow>
          <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
          <meshStandardMaterial color="#c4c8cd" roughness={0.95} />
        </mesh>
        {config.cells.map((c) => (
          <group
            key={c.id}
            name={`cell:${config.site}/${c.id}`}
            position={c.pose.position_m}
            rotation-z={deg(c.pose.yaw_deg)}
          >
            <CellMarker />
          </group>
        ))}
      </group>
    </>
  );
}

/** M0 자리표시: 셀 원점의 바닥 표시. M1에서 작업판·로봇으로 바뀐다. */
function CellMarker() {
  return (
    <mesh position={[0, 0, 0.01]}>
      <boxGeometry args={[2.4, 2.4, 0.02]} />
      <meshStandardMaterial color="#e2a63b" roughness={0.6} />
    </mesh>
  );
}

function CameraRig({ config, preset }: Props) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const p = config.presets.find((x) => x.id === preset);
    if (!p) return;
    camera.position.set(...siteToScene(p.eye_m));
    camera.lookAt(...siteToScene(p.target_m));
    camera.updateProjectionMatrix();
  }, [camera, config, preset]);
  return null;
}
