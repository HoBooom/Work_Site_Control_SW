import { useGLTF } from '@react-three/drei';
import { Selection } from '@react-three/postprocessing';
import { useMemo } from 'react';
import { Mesh } from 'three';
import type { SiteConfig } from '../contracts/messages.gen';
import { CameraControls } from './CameraControls';
import { Cell } from './Cell';
import { Effects } from './Effects';
import { SITE_TO_SCENE_ROTATION_X } from './frame';
import { Lighting } from './Lighting';
import { QUALITY, type QualityTier } from './quality';
import { useSelection } from './selection';

interface Props {
  config: SiteConfig;
  /** 카메라 프리셋 id */
  preset: string;
  /** 품질 등급(RD-05) */
  tier: QualityTier;
}

/** 씬의 입구. site-config와 store만 읽는다(spec 3절). 로딩은 Suspense, 실패는 바깥 ErrorBoundary가 받는다. */
export function TwinScene({ config, preset, tier }: Props) {
  const quality = QUALITY[tier];
  return (
    <Selection>
      <Lighting config={config} quality={quality} />
      <CameraControls config={config} preset={preset} />
      {config.background.glb && <Background site={config.site} url={config.background.glb} />}
      <group name={`site:${config.site}`} rotation-x={SITE_TO_SCENE_ROTATION_X}>
        {config.cells.map((c) => (
          <Cell key={c.id} site={config.site} cell={c} surfaces={config.surfaces} />
        ))}
      </group>
      <Effects quality={quality} tier={tier} />
    </Selection>
  );
}

/** 정적 층. GLB는 파이프라인이 Y-up으로 내보내므로 씬 루트에 그대로 놓는다. 누르면 선택 해제 */
function Background({ site, url }: { site: string; url: string }) {
  const gltf = useGLTF(url, false);
  const select = useSelection((s) => s.select);
  // 배경은 그림자를 받고 드리운다(RD-03). useGLTF가 캐시한 원본을 바꾸므로 한 번만 해도 된다
  useMemo(() => {
    gltf.scene.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [gltf]);
  // GLTFLoader는 노드 이름의 ':'를 지우므로 이름은 여기서 붙인다
  return (
    <group name={`background:${site}`}>
      <primitive object={gltf.scene} onClick={() => select(null)} />
    </group>
  );
}
