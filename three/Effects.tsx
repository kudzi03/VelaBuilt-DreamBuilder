"use client";

import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import { useRef } from "react";
import { TIERS } from "@/lib/quality";
import { useDemo } from "@/lib/store";
import { channels } from "./shared";

const TONE = (() => {
  if (typeof window === "undefined") return ToneMappingMode.AGX;
  const q = new URLSearchParams(window.location.search).get("tm");
  return q === "aces" ? ToneMappingMode.ACES_FILMIC : q === "neutral" ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
})();

export function Effects() {
  const tier = useDemo((s) => s.tier);
  const aoOff = useDemo((s) => s.aoOff);
  const T = TIERS[tier];
  const bloom = useRef<BloomEffect>(null);

  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 0.12 + channels.dusk * 0.9 + channels.hvac * 0.25;
  });

  if (!T.post) return null;
  return (
    <EffectComposer multisampling={T.msaa} enableNormalPass={false}>
      <N8AO
        enabled={T.ao && !aoOff}
        halfRes={T.aoHalfRes}
        aoRadius={1.1}
        distanceFalloff={0.55}
        intensity={2.2}
        aoSamples={T.aoHalfRes ? 8 : 14}
        denoiseSamples={T.aoHalfRes ? 4 : 6}
        denoiseRadius={10}
        color="#2a2118"
      />
      <Bloom ref={bloom} mipmapBlur intensity={0.12} luminanceThreshold={1.25} luminanceSmoothing={0.35} radius={0.72} />
      <ToneMapping mode={TONE} />
      {/* a photographer's grade on top of the neutral filmic curve: a touch of density and colour */}
      <HueSaturation saturation={0.14} />
      <BrightnessContrast contrast={0.07} brightness={-0.01} />
      <Vignette offset={0.32} darkness={0.38} eskil={false} />
    </EffectComposer>
  );
}
