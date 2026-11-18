import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, Outline, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect } from 'react';
import type { QualitySettings } from './quality';

/** bloom 밝기 문턱(linear). 아크 코어는 이보다 몇 배 밝게 그린다(Robot.tsx ARC_CORE) */
export const ARC_BLOOM_THRESHOLD = 1.5;

interface Props {
  quality: QualitySettings;
  tier: string;
}

/**
 * 후처리. RD-04 SSAO(N8AO, high만), IX-02 선택 외곽선, RD-06 아크 bloom(high만), 톤매핑(Khronos PBR Neutral, spec 2절).
 * bloom 문턱(ARC_BLOOM_THRESHOLD)은 1보다 커서 HDR로 그리는 용접 아크만 번진다(상태 램프·화면 밝은 곳은 번지지 않는다).
 * 후처리를 쓰면 렌더러의 톤매핑 대신 ToneMapping 효과가 맡는다.
 * 켜진 효과 목록을 scene.userData.effects에 남긴다(디버그 API·테스트용).
 */
export function Effects({ quality, tier }: Props) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.userData.effects = [...(quality.ssao ? ['n8ao'] : []), 'outline', ...(quality.bloom ? ['bloom'] : []), 'tonemapping-neutral'];
    scene.userData.quality = tier;
  }, [scene, quality.ssao, quality.bloom, tier]);
  return (
    <EffectComposer multisampling={quality.msaa} autoClear={false}>
      {quality.ssao ? (
        <N8AO aoRadius={0.6} distanceFalloff={0.6} intensity={2.2} quality="medium" color="black" />
      ) : (
        <></>
      )}
      <Outline visibleEdgeColor={0x1f8bff} hiddenEdgeColor={0x1f8bff} edgeStrength={14} blur={false} xRay />
      {quality.bloom ? <Bloom luminanceThreshold={ARC_BLOOM_THRESHOLD} luminanceSmoothing={0.2} intensity={1.6} mipmapBlur /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
