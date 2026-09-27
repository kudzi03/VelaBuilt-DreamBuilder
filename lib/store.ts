"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { IndustryId } from "./industries";
import type {
  CabinetId,
  ChannelId,
  CoatingId,
  CounterId,
  FloorId,
  HvacIssueId,
  IslandId,
  OffsetId,
  PanelFinishId,
  RoofAgeId,
  RoofIssueId,
  RoofMaterialId,
  SurfaceId,
  SystemAgeId,
  TimelineId,
} from "./options";
import type { RoofSectionId, Vec3 } from "./spec";
import type { TrussType } from "./steel";

export type Phase = "loading" | "intro" | "explore" | "qualify" | "flow" | "reveal";
export type Tier = "low" | "medium" | "high";
export type Layout = "mobile" | "desktop" | "landscape";
export type SheetSnap = "peek" | "half" | "full";

export interface RemodelConfig {
  cabinets: CabinetId;
  counter: CounterId;
  floor: FloorId;
  island: IslandId;
}

export interface RoofFlag {
  id: number;
  section: RoofSectionId;
  issue: RoofIssueId;
  point: Vec3;
  normal: Vec3;
}

export interface RoofConfig {
  material: RoofMaterialId;
  color: string;
  inspect: boolean;
  pending: { section: RoofSectionId; point: Vec3; normal: Vec3 } | null;
  flags: RoofFlag[];
}

export interface AttachedFile {
  name: string;
  size: number;
  type: string;
}

export interface SteelConfig {
  truss: TrussType;
  coating: CoatingId;
  explode: number;
  ghost: boolean;
  selected: string | null;
  files: AttachedFile[];
  replay: number;
}

export interface SolarConfig {
  panels: number;
  finish: PanelFinishId;
  battery: 0 | 1 | 2;
  offset: OffsetId;
  owner: "yes" | "no" | null;
  roofAge: RoofAgeId | null;
}

export interface LandscapeConfig {
  surface: SurfaceId;
  pergola: boolean;
  pool: boolean;
  planting: "minimal" | "lush";
  evening: boolean;
}

export interface HvacConfig {
  issue: HvacIssueId;
  mode: "cool" | "heat";
  age: SystemAgeId | null;
  zone: "upstairs" | "main" | "kitchen" | null;
  slot: string | null;
}

export interface Qualification {
  timeline: TimelineId | null;
  channel: ChannelId | null;
  name: string;
}

export interface Engagement {
  ms: number;
  actions: number;
  compare: boolean;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Configs {
  remodeling: RemodelConfig;
  roofing: RoofConfig;
  steel: SteelConfig;
  solar: SolarConfig;
  landscaping: LandscapeConfig;
  hvac: HvacConfig;
}

export interface DemoState extends Configs {
  phase: Phase;
  industry: IndustryId | null;
  lastIndustry: IndustryId | null;
  sceneReady: boolean;
  webgl: boolean;
  tier: Tier;
  aoOff: boolean;
  reducedMotion: boolean;
  layout: Layout;
  sheet: SheetSnap;
  insets: Insets;
  compare: boolean;
  split: number;
  qualification: Qualification;
  company: string | null;
  ref: string | null;
  engagement: Partial<Record<IndustryId, Engagement>>;
  enteredAt: number;
  leadFormOpen: boolean;
  howOpen: boolean;
  shareOpen: boolean;
  flowRun: number;
  announce: string;

  set: (p: Partial<DemoState>) => void;
  setPhase: (p: Phase) => void;
  selectIndustry: (id: IndustryId) => void;
  patch: <K extends keyof Configs>(key: K, value: Partial<Configs[K]>) => void;
  setCompare: (on: boolean) => void;
  setSplit: (v: number) => void;
  setInsets: (i: Insets) => void;
  setSheet: (s: SheetSnap) => void;
  setQualification: (q: Partial<Qualification>) => void;
  setAnnounce: (s: string) => void;
  flushEngagement: () => void;
}

export const DEFAULTS: Configs = {
  remodeling: { cabinets: "sage-shaker", counter: "calacatta", floor: "oak-plank", island: "waterfall" },
  roofing: { material: "metal", color: "matte-black", inspect: false, pending: null, flags: [] },
  steel: { truss: "fink", coating: "galvanised", explode: 0, ghost: true, selected: null, files: [], replay: 0 },
  solar: { panels: 14, finish: "black", battery: 1, offset: "most", owner: null, roofAge: null },
  landscaping: { surface: "stone", pergola: true, pool: true, planting: "lush", evening: false },
  hvac: { issue: "uneven", mode: "cool", age: null, zone: null, slot: null },
};

export const useDemo = create<DemoState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,
    phase: "loading",
    industry: null,
    lastIndustry: null,
    sceneReady: false,
    webgl: true,
    tier: "high",
    aoOff: false,
    reducedMotion: false,
    layout: "desktop",
    sheet: "half",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    compare: false,
    split: 0.5,
    qualification: { timeline: null, channel: null, name: "" },
    company: null,
    ref: null,
    engagement: {},
    enteredAt: 0,
    leadFormOpen: false,
    howOpen: false,
    shareOpen: false,
    flowRun: 0,
    announce: "",

    set: (p) => set(p),
    setPhase: (phase) => set({ phase }),

    selectIndustry: (id) => {
      get().flushEngagement();
      const s = get();
      set({
        industry: id,
        lastIndustry: id,
        phase: "explore",
        compare: false,
        split: 0.5,
        enteredAt: performance.now(),
        sheet: s.layout === "mobile" ? "half" : s.sheet,
        roofing: { ...s.roofing, inspect: false, pending: null },
        steel: { ...s.steel, selected: null, replay: s.steel.replay + 1 },
      });
    },

    patch: (key, value) => {
      const s = get();
      const eng = s.engagement[key as IndustryId] ?? { ms: 0, actions: 0, compare: false };
      set({
        [key]: { ...s[key], ...value },
        engagement: { ...s.engagement, [key]: { ...eng, actions: eng.actions + 1 } },
      } as Partial<DemoState>);
    },

    setCompare: (on) => {
      const s = get();
      const id = s.industry;
      if (on && id) {
        const eng = s.engagement[id] ?? { ms: 0, actions: 0, compare: false };
        set({ compare: true, split: 0.5, engagement: { ...s.engagement, [id]: { ...eng, compare: true, actions: eng.actions + 1 } } });
      } else set({ compare: on });
    },

    setSplit: (split) => set({ split: Math.min(0.97, Math.max(0.03, split)) }),
    setInsets: (insets) => {
      const cur = get().insets;
      if (cur.top === insets.top && cur.right === insets.right && cur.bottom === insets.bottom && cur.left === insets.left) return;
      set({ insets });
    },
    setSheet: (sheet) => set({ sheet }),
    setQualification: (q) => set({ qualification: { ...get().qualification, ...q } }),
    setAnnounce: (announce) => set({ announce }),

    flushEngagement: () => {
      const s = get();
      if (!s.industry || !s.enteredAt) return;
      const eng = s.engagement[s.industry] ?? { ms: 0, actions: 0, compare: false };
      const now = performance.now();
      set({
        enteredAt: now,
        engagement: { ...s.engagement, [s.industry]: { ...eng, ms: eng.ms + (now - s.enteredAt) } },
      });
    },
  })),
);

/** The industry the visitor spent the most time with — used to prefill the enquiry. */
export function topIndustry(s: DemoState): IndustryId | null {
  let best: IndustryId | null = s.lastIndustry;
  let bestMs = -1;
  for (const [id, e] of Object.entries(s.engagement)) {
    const score = (e?.ms ?? 0) + (e?.actions ?? 0) * 4000;
    if (score > bestMs) {
      bestMs = score;
      best = id as IndustryId;
    }
  }
  return best;
}
