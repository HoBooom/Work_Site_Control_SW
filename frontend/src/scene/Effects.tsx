import { useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, Outline, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect } from 'react';
import type { QualitySettings } from './quality';

interface Props {
  quality: QualitySettings;
  tier: string;
}

/**
 * 후처리. RD-04 SSAO(N8AO, high만), IX-02 선택 외곽선, 톤매핑(Khronos PBR Neutral, spec 2절).
 * 후처리를 쓰면 렌더러의 톤매핑 대신 ToneMapping 효과가 맡는다.
 * 켜진 효과 목록을 scene.userData.effects에 남긴다(디버그 API·테스트용).
 */
export function Effects({ quality, tier }: Props) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.userData.effects = [...(quality.ssao ? ['n8ao'] : []), 'outline', 'tonemapping-neutral'];
    scene.userData.quality = tier;
  }, [scene, quality.ssao, tier]);
  return (
    <EffectComposer multisampling={quality.msaa} autoClear={false}>
      {quality.ssao ? (
        <N8AO aoRadius={0.6} distanceFalloff={0.6} intensity={2.2} quality="medium" color="black" />
      ) : (
        <></>
      )}
      <Outline visibleEdgeColor={0x1f8bff} hiddenEdgeColor={0x1f8bff} edgeStrength={14} blur={false} xRay />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
