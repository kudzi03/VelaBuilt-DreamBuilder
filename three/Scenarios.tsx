"use client";

import { useEffect, useState } from "react";
import type { IndustryId } from "@/lib/industries";
import { useDemo } from "@/lib/store";
import { Garden } from "./Garden";
import { Hvac } from "./Hvac";
import { Kitchen } from "./Kitchen";
import { Solar } from "./Solar";
import { Steel } from "./Steel";
import { prefetch } from "./textures";

type Layer = "garden" | "hvac" | "solar" | "steel" | "kitchen";
const FOR: Record<IndustryId, Layer | null> = { landscaping: "garden", hvac: "hvac", solar: "solar", steel: "steel", remodeling: "kitchen", roofing: null };
const ORDER: Layer[] = ["hvac", "solar", "steel", "kitchen"];

/**
 * Scenario layers mount progressively after the first frame (one per idle slot)
 * so the arrival renders fast; a selected industry mounts immediately.
 */
export function Scenarios() {
  const sceneReady = useDemo((s) => s.sceneReady);
  const industry = useDemo((s) => s.industry);
  const [on, setOn] = useState<Set<Layer>>(() => new Set());

  useEffect(() => {
    if (!sceneReady) return;
    prefetch(["wood_floor", "oak_veneer_01", "wood_floor_deck"]);
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      const layer = ORDER[i++];
      if (!layer) return;
      setOn((s) => (s.has(layer) ? s : new Set(s).add(layer)));
      t = setTimeout(next, 450);
    };
    t = setTimeout(next, 300);
    return () => clearTimeout(t);
  }, [sceneReady]);

  // The selected industry's layer mounts immediately, without waiting for its idle slot.
  const selected = industry ? FOR[industry] : null;
  const has = (l: Layer) => on.has(l) || selected === l;

  return (
    <>
      <Garden />
      {has("hvac") && <Hvac />}
      {has("solar") && <Solar />}
      {has("steel") && <Steel />}
      {has("kitchen") && <Kitchen />}
    </>
  );
}
