"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { setAnalyticsContext, track } from "@/lib/analytics";
import { isIndustryId } from "@/lib/industries";
import { detectTier, isTouchDevice, prefersReducedMotion, webglAvailable } from "@/lib/quality";
import { useDemo, type Insets, type Layout } from "@/lib/store";
import { CompareHandle } from "./CompareHandle";
import { Flow } from "./Flow";
import { Orbit } from "./icons";
import { Intro, Loader } from "./Intro";
import { LeadForm } from "./LeadForm";
import { Panel, sheetHeights } from "./Panel";
import { HowItWorks, Reveal, ShareSheet } from "./Reveal";
import { selectIndustry, TopBar } from "./TopBar";

const Stage = dynamic(() => import("@/three/Stage"), { ssr: false });

function layoutFor(w: number, h: number): Layout {
  if (w < 760 && h >= w) return "mobile";
  if (h < 520 && w > h) return "landscape";
  return "desktop";
}

/** Where an element comes to rest: panels slide in, so their entry transform is taken out. */
function rect(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return r;
  const m = new DOMMatrixReadOnly(t);
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height);
}

function computeInsets(): Insets {
  // stills for the industry tiles are rendered with no UI (scripts/og/previews.mjs)
  if ((window as unknown as { __bare?: boolean }).__bare) return { top: 0, right: 0, bottom: 0, left: 0 };
  const s = useDemo.getState();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const L = s.layout;
  const topBar = rect(".topbar")?.bottom ?? 60;
  const switcher = rect(".switcher[data-visible='true']");
  const top = Math.max(topBar, switcher?.bottom ?? 0) + 8;
  const zero = { top, right: 0, bottom: 0, left: 0 };
  switch (s.phase) {
    case "loading":
    case "intro": {
      const copy = rect(".intro__copy");
      const choose = rect(".intro__choose");
      if (L === "mobile") return { ...zero, top: Math.max(top, (copy?.bottom ?? 260) + 4), bottom: choose ? h - choose.top + 4 : 320 };
      if (L === "landscape") return { ...zero, left: Math.max(copy?.right ?? 0, choose?.right ?? 0, w * 0.4) + 12 };
      return { ...zero, left: copy ? Math.min(copy.right + 16, w * 0.5) : w * 0.42, bottom: choose ? h - choose.top + 8 : 190 };
    }
    case "explore":
    case "qualify": {
      if (L === "mobile") {
        const H = sheetHeights(h);
        return { ...zero, bottom: s.phase === "qualify" ? H.full : H[s.sheet] };
      }
      const p = rect(".panel");
      return { ...zero, right: p ? w - p.left + 12 : 440 };
    }
    case "flow": {
      const f = rect(".flow");
      if (L === "mobile") return { ...zero, bottom: f ? h - f.top : h * 0.74 };
      return { ...zero, right: f ? w - f.left + 12 : 500 };
    }
    case "reveal": {
      const r = rect(".reveal__inner");
      if (L === "mobile") return { ...zero, bottom: r ? h - r.top + 8 : h * 0.55 };
      return { ...zero, left: r ? r.right + 8 : w * 0.45 };
    }
  }
}

function useLayoutTracking() {
  const phase = useDemo((s) => s.phase);
  const sheet = useDemo((s) => s.sheet);
  const industry = useDemo((s) => s.industry);
  useEffect(() => {
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const s = useDemo.getState();
        const layout = layoutFor(window.innerWidth, window.innerHeight);
        if (layout !== s.layout) s.set({ layout });
        s.setInsets(computeInsets());
      });
    };
    run();
    // after entry animations settle
    const t1 = setTimeout(run, 450);
    const t2 = setTimeout(run, 1200);
    const t3 = setTimeout(run, 2600);
    window.addEventListener("resize", run);
    window.addEventListener("orientationchange", run);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", run);
      window.removeEventListener("orientationchange", run);
    };
  }, [phase, sheet, industry]);
}

function Hint() {
  const webgl = useDemo((s) => s.webgl);
  const phase = useDemo((s) => s.phase);
  const industry = useDemo((s) => s.industry);
  const [seen, setSeen] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (phase !== "explore" || seen) return;
    const t = setTimeout(() => setShow(true), 1400);
    const off = () => {
      setShow(false);
      setSeen(true);
    };
    const t2 = setTimeout(off, 7000);
    const canvas = document.querySelector(".stage");
    canvas?.addEventListener("pointerdown", off, { once: true });
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      canvas?.removeEventListener("pointerdown", off);
    };
  }, [phase, industry, seen]);
  const touch = typeof window !== "undefined" && isTouchDevice();
  return (
    <AnimatePresence>
      {show && webgl && phase === "explore" && (
        <motion.p className="hint" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <Orbit size={16} /> {touch ? "Drag to look around · pinch to zoom" : "Drag to look around · scroll to zoom"}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function Announcer() {
  const announce = useDemo((s) => s.announce);
  return (
    <div className="sr-only" aria-live="polite" role="status">
      {announce}
    </div>
  );
}

export function Experience() {
  const phase = useDemo((s) => s.phase);
  const webgl = useDemo((s) => s.webgl);
  const layout = useDemo((s) => s.layout);
  const mounted = useDemo((s) => s.booted);
  useLayoutTracking();

  useEffect(() => {
    const s = useDemo.getState();
    const params = new URLSearchParams(location.search);
    // a company name, not arbitrary text: letters, digits and ordinary business punctuation;
    // anything else (URLs, symbols, markup) drops the personalisation instead of displaying it
    const rawCompany = params.get("company")?.replace(/\s+/g, " ").trim() ?? "";
    const company = rawCompany && rawCompany.length <= 60 && /^[\p{L}\p{N}][\p{L}\p{N} &'’.,()-]*$/u.test(rawCompany) && !/\.(com|net|org|io|co|xyz|ru)\b|https?|www\./i.test(rawCompany) ? rawCompany : null;
    const ref = params.get("ref") || params.get("utm_source") || null;
    if (params.has("debug")) (window as unknown as { __store: typeof useDemo }).__store = useDemo;
    const gl = webglAvailable();
    const tier = detectTier();
    s.set({ tier, reducedMotion: prefersReducedMotion(), company, ref, webgl: gl, layout: layoutFor(innerWidth, innerHeight), booted: true });
    setAnalyticsContext({ tier, ref: ref ?? undefined, layout: layoutFor(innerWidth, innerHeight), personalised: !!company });
    if (!gl) {
      s.set({ sceneReady: true, phase: "intro" });
      track("demo_loaded", { tier: "none", webgl: false });
    }
    const pre = params.get("industry");
    if (isIndustryId(pre)) {
      const wait = setInterval(() => {
        if (useDemo.getState().phase === "intro") {
          clearInterval(wait);
          setTimeout(() => selectIndustry(pre, "link"), prefersReducedMotion() ? 0 : 2600);
        }
      }, 200);
      return () => clearInterval(wait);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => useDemo.getState().set({ reducedMotion: mq.matches });
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  return (
    <main className="app" id="main" data-phase={phase} data-layout={layout}>
      <a className="skip-link" href={phase === "explore" || phase === "qualify" ? "#panel" : phase === "flow" ? "#flow" : "#main-content"}>
        Skip to {phase === "explore" || phase === "qualify" ? "controls" : "content"}
      </a>
      {mounted && webgl && <Stage />}
      {!webgl && <div className="poster" aria-hidden />}
      <TopBar />
      <Loader />
      <Intro />
      <Panel />
      <CompareHandle />
      <Flow />
      <Reveal />
      <Hint />
      <LeadForm />
      <HowItWorks />
      <ShareSheet />
      <Announcer />
      <noscript>
        <p className="noscript">This interactive demo needs JavaScript. Email jace@velabuilt.com to see it in person.</p>
      </noscript>
    </main>
  );
}
