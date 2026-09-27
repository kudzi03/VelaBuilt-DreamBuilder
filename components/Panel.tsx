"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { track } from "@/lib/analytics";
import { upcomingSlots } from "@/lib/estimate";
import { INDUSTRY_BY_ID } from "@/lib/industries";
import { sampleName } from "@/lib/lead";
import { CHANNELS, TIMELINES } from "@/lib/options";
import { useDemo, type SheetSnap } from "@/lib/store";
import { Arrow, Back, IndustryIcon } from "./icons";
import { EstimateLine, PANELS } from "./panels";
import { Chips } from "./ui";

const EASE = [0.16, 1, 0.3, 1] as const;

export function sheetHeights(h: number) {
  return { peek: 196, half: Math.round(h * 0.5), full: Math.round(h * 0.88) };
}

const ORDER: SheetSnap[] = ["peek", "half", "full"];

function Qualify() {
  const q = useDemo((s) => s.qualification);
  const setQ = useDemo((s) => s.setQualification);
  useEffect(() => {
    if (!useDemo.getState().qualification.name) setQ({ name: sampleName().split(" ")[0] });
  }, [setQ]);
  return (
    <div className="qualify">
      <div className="q-block">
        <p className="q">When would you like this done?</p>
        <Chips label="Timeline" options={TIMELINES} value={q.timeline} onChange={(v) => setQ({ timeline: v })} />
      </div>
      <div className="q-block">
        <p className="q">Best way to reach you?</p>
        <Chips label="Contact preference" options={CHANNELS} value={q.channel} onChange={(v) => setQ({ channel: v })} />
      </div>
      <label className="field">
        <span className="q">First name</span>
        <input type="text" value={q.name} maxLength={24} autoComplete="off" onChange={(e) => setQ({ name: e.target.value })} />
        <small className="muted">Sample customer for the demo — nothing leaves this page.</small>
      </label>
    </div>
  );
}

export function Panel() {
  const phase = useDemo((s) => s.phase);
  const industry = useDemo((s) => s.industry);
  const layout = useDemo((s) => s.layout);
  const sheet = useDemo((s) => s.sheet);
  const setSheet = useDemo((s) => s.setSheet);
  const setPhase = useDemo((s) => s.setPhase);
  const q = useDemo((s) => s.qualification);
  const [vh, setVh] = useState(800);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef({ y: 0, h: 0, t: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [industry, phase]);

  const visible = (phase === "explore" || phase === "qualify") && !!industry;
  const ind = INDUSTRY_BY_ID[industry ?? "roofing"];
  const Body = PANELS[industry ?? "roofing"];
  const mobile = layout === "mobile";
  const H = sheetHeights(vh);
  const snapH = phase === "qualify" ? H.full : H[sheet];
  const height = mobile ? (drag ?? snapH) : undefined;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!mobile) return;
    start.current = { y: e.clientY, h: snapH, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(snapH);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    setDrag(Math.max(H.peek * 0.8, Math.min(H.full, start.current.h + (start.current.y - e.clientY))));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    const dy = start.current.y - e.clientY;
    const v = dy / Math.max(1, performance.now() - start.current.t);
    setDrag(null);
    if (phase === "qualify") return;
    const i = ORDER.indexOf(sheet);
    if (Math.abs(dy) < 6) {
      setSheet(sheet === "peek" ? "half" : "peek");
      return;
    }
    if (v > 0.45) return setSheet(ORDER[Math.min(2, i + 1)]);
    if (v < -0.45) return setSheet(ORDER[Math.max(0, i - 1)]);
    const h = start.current.h + dy;
    let best: SheetSnap = "peek";
    for (const k of ORDER) if (Math.abs(H[k] - h) < Math.abs(H[best] - h)) best = k;
    setSheet(best);
  };

  const toQualify = () => {
    const s = useDemo.getState();
    if (industry === "hvac" && !s.hvac.slot) s.patch("hvac", { slot: upcomingSlots()[0].id });
    s.flushEngagement();
    s.set({ compare: false });
    s.patch("roofing", { inspect: false, pending: null });
    track("interaction_completed", { industry, action: "request_started" });
    setPhase("qualify");
  };

  const submit = () => {
    const s = useDemo.getState();
    s.flushEngagement();
    track("business_flow_viewed", { industry, timeline: s.qualification.timeline, channel: s.qualification.channel });
    s.set({ flowRun: s.flowRun + 1 });
    setPhase("flow");
  };

  const ready = !!q.timeline && !!q.channel;

  return (
    <AnimatePresence>
      {visible && industry && (
      <motion.aside
        key="panel"
        id="panel"
        className="panel"
        data-layout={layout}
        data-dragging={drag != null}
        style={{ height }}
        initial={mobile ? { y: 60, opacity: 0 } : { x: 40, opacity: 0 }}
        animate={{ y: 0, x: 0, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        aria-label={`${ind.name} — customer view`}
      >
        <div className="panel__grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {mobile && <span className="panel__handle" aria-hidden />}
          <header className="panel__head">
            <p className="panel__role mono">
              <span className="panel__role-dot" aria-hidden />
              Customer view
              <span className="panel__role-sep" aria-hidden>
                ·
              </span>
              <IndustryIcon id={industry} size={13} />
              {ind.name}
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={phase + industry} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }}>
                <h2 className="panel__title">{phase === "qualify" ? "Two quick questions" : ind.title}</h2>
                <p className="panel__lede">{phase === "qualify" ? "Your customer answers these before sending. They tell you who is ready to buy." : ind.customer}</p>
              </motion.div>
            </AnimatePresence>
          </header>
        </div>

        <div className="panel__body" ref={bodyRef}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={phase + industry} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {phase === "qualify" ? <Qualify /> : <Body />}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="panel__foot">
          {phase === "explore" ? (
            <>
              <EstimateLine industry={industry} />
              <button type="button" className="btn btn--primary btn--block" onClick={toQualify}>
                <span>{ind.cta}</span>
                <Arrow />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--block" disabled={!ready} onClick={submit}>
                <span>{ready ? "Send my request" : "Answer both to send"}</span>
                <Arrow />
              </button>
              <button type="button" className="link link--back" onClick={() => setPhase("explore")}>
                <Back size={15} /> Back to the design
              </button>
            </>
          )}
        </footer>
      </motion.aside>
      )}
    </AnimatePresence>
  );
}
