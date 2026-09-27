"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IndustryId } from "@/lib/industries";
import { track } from "@/lib/analytics";
import { formatSlot, upcomingSlots } from "@/lib/estimate";
import { INDUSTRY_BY_ID } from "@/lib/industries";
import { buildLead, type Lead } from "@/lib/lead";
import { useDemo } from "@/lib/store";
import { detectUnits } from "@/lib/units";
import { Arrow, Calendar, Check, Mail, Replay, WhatsApp } from "./icons";

const EASE = [0.16, 1, 0.3, 1] as const;
const STEPS = ["Customer explores", "Configures the project", "Gets an estimate", "Qualified lead", "Lands in your CRM", "Automated follow-up", "Appointment booked", "Job created"];
const DELAY = [450, 750, 900, 1300, 1700, 1500, 1300, 1300];
const BOOK_STEP = 6;
const PIPE = ["New", "Qualified", "Quoted", "Booked", "Won"];

function initials(n: string) {
  return n
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ScoreRing({ score, band }: { score: number; band: Lead["band"] }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="score">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
        <circle cx="38" cy="38" r={r} className="score__track" />
        <motion.circle
          cx="38"
          cy="38"
          r={r}
          className="score__arc"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.15 }}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="score__num">
        <strong>{score}</strong>
        <span className="mono">{band}</span>
      </div>
    </div>
  );
}

function StepBody({ i, lead, booked, onBook, elapsed }: { i: number; lead: Lead; booked: string | null; onBook: (slot: string) => void; elapsed: number }) {
  const slots = useMemo(() => upcomingSlots().filter((_, k) => k % 2 === 0 || k === 1).slice(0, 3), []);
  switch (i) {
    case 0:
      return (
        <p className="fl-line">
          {lead.source} · {lead.explored} · {lead.choices} choice{lead.choices === 1 ? "" : "s"}
        </p>
      );
    case 1:
      return (
        <dl className="fl-spec">
          {lead.spec.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      );
    case 2:
      return (
        <div className="fl-estimate">
          <strong>{lead.estimate}</strong>
          <span className="mono">shown on screen · sample pricing</span>
          {lead.notes.length > 0 && (
            <ul>
              {lead.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      );
    case 3:
      return (
        <div className="fl-qual">
          <ScoreRing score={lead.score} band={lead.band} />
          <ul className="fl-reasons">
            {lead.reasons.map((r) => (
              <li key={r.text}>
                <span className="mono">{r.points > 0 ? `+${r.points}` : r.points}</span>
                {r.text}
              </li>
            ))}
          </ul>
        </div>
      );
    case 4:
      return (
        <div className="crm">
          <div className="crm__head">
            <span className="crm__avatar">{initials(lead.name)}</span>
            <div>
              <strong>{lead.name}</strong>
              <span>{lead.project} · just now</span>
            </div>
            <span className={`crm__band crm__band--${lead.band.toLowerCase()}`}>{lead.band}</span>
          </div>
          <ol className="pipe" aria-label="Pipeline stage: Qualified">
            {PIPE.map((p, k) => (
              <li key={p} data-state={k < 1 ? "done" : k === 1 ? "now" : "next"}>
                <span />
                {p}
              </li>
            ))}
          </ol>
          <dl className="crm__fields">
            <div>
              <dt>Source</dt>
              <dd>{lead.source}</dd>
            </div>
            <div>
              <dt>Estimate</dt>
              <dd>{lead.estimate}</dd>
            </div>
            <div>
              <dt>Timeline</dt>
              <dd>{lead.timeline}</dd>
            </div>
            <div>
              <dt>Prefers</dt>
              <dd>{lead.channel}</dd>
            </div>
          </dl>
          <p className="crm__task">
            <Check size={14} /> Task created: call {lead.first} today · assigned to your estimator
          </p>
        </div>
      );
    case 5:
      return (
        <div className="chat">
          <p className="chat__meta mono">
            <WhatsApp size={13} /> WhatsApp · sent automatically {elapsed}s after the request
          </p>
          <div className="bubble bubble--out">
            <p>{lead.message}</p>
            {!booked && lead.industry !== "hvac" && (
              <div className="bubble__slots" role="group" aria-label="Pick a time">
                {slots.map((s) => (
                  <button key={s.id} type="button" className="bubble__slot" onClick={() => onBook(s.id)}>
                    {s.day} · {s.window}
                  </button>
                ))}
              </div>
            )}
          </div>
          {booked && lead.industry !== "hvac" && (
            <motion.div className="bubble bubble--in" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <p>{formatSlot(booked).split(",")[0]} works for me.</p>
            </motion.div>
          )}
          <p className="fl-line fl-line--icon">
            <Mail size={15} /> Email sent · estimate and design summary attached
          </p>
          <p className="fl-line fl-line--quiet">Day 3 and day 10 reminders queued. They stop the moment {lead.first} replies.</p>
          {!booked && lead.industry !== "hvac" && <p className="fl-hint mono">Tap a time — you&apos;re the customer</p>}
        </div>
      );
    case 6:
      return (
        <div className="cal">
          <Calendar size={18} />
          <div>
            <strong>{booked ? formatSlot(booked) : ""}</strong>
            <span>
              {lead.appointment} · {lead.name}
            </span>
            <small>In your calendar · confirmation sent · reminder the day before</small>
          </div>
        </div>
      );
    case 7:
      return (
        <div className="fl-job">
          <p>{lead.job}</p>
          <small>Nothing re-typed. Everything {lead.first} chose travels with the job.</small>
        </div>
      );
  }
  return null;
}

export function Flow() {
  const phase = useDemo((s) => s.phase);
  const industry = useDemo((s) => s.industry);
  const flowRun = useDemo((s) => s.flowRun);
  const active = phase === "flow" && !!industry;
  // Keyed by run: a replay mounts a fresh sequence instead of resetting state in an effect.
  return <AnimatePresence>{active && industry && <FlowRun key={`${industry}-${flowRun}`} industry={industry} flowRun={flowRun} />}</AnimatePresence>;
}

function FlowRun({ industry, flowRun }: { industry: IndustryId; flowRun: number }) {
  const reduced = useDemo((s) => s.reducedMotion);
  const layout = useDemo((s) => s.layout);
  const set = useDemo((s) => s.set);
  const [step, setStep] = useState(0);
  const [booked, setBooked] = useState<string | null>(() => (industry === "hvac" ? useDemo.getState().hvac.slot : null));
  const [lead] = useState(() => buildLead(industry, useDemo.getState(), detectUnits()));
  const t0 = useRef(0);
  const [elapsed, setElapsed] = useState(4);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    t0.current = performance.now();
  }, []);

  useEffect(() => {
    if (step >= STEPS.length) return;
    if (step === BOOK_STEP && !booked) return;
    const t = setTimeout(
      () => {
        if (step === 5) setElapsed(Math.max(2, Math.round((performance.now() - t0.current) / 1000)));
        setStep((x) => x + 1);
      },
      reduced ? 80 : DELAY[step],
    );
    return () => clearTimeout(t);
  }, [step, booked, reduced]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-step="${Math.min(step, STEPS.length) - 1}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    if (step === STEPS.length) track("business_flow_completed", { industry });
  }, [step, reduced, industry]);

  const done = step >= STEPS.length;
  const headline = step < 4 ? "Your customer just became a qualified lead." : step < 7 ? "Follow-up sent automatically." : `${lead.appointment} booked.`;
  const ind = INDUSTRY_BY_ID[industry];

  return (
    <motion.aside
      key="flow"
      id="flow"
      tabIndex={-1}
      className="flow"
      data-layout={layout}
      initial={layout === "mobile" ? { y: "12%", opacity: 0 } : { x: 60, opacity: 0 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ duration: 0.8, ease: EASE }}
      aria-label="What happens in your business"
    >
      <header className="flow__head">
        <div className="flow__roles">
          <p className="mono flow__role">
            <span className="flow__role-dot" aria-hidden /> Your view
          </p>
          <span className="demo-chip mono">System demo · sample data</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2 key={headline} className="flow__title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: EASE }} aria-live="polite">
            {step === 0 ? "Sending the request…" : headline}
          </motion.h2>
        </AnimatePresence>
      </header>

      <ol className="flow__list" ref={listRef} tabIndex={0} aria-label="What happened, step by step">
        {STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "now" : "next";
          if (i > step) return null;
          if (i === BOOK_STEP && !booked) return null;
          return (
            <motion.li key={`${flowRun}-${i}`} data-step={i} data-state={state} className="fl-step" initial={{ opacity: 0, y: reduced ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
              <span className="fl-step__node" aria-hidden>
                {state === "done" ? <Check size={12} /> : <span />}
              </span>
              <div className="fl-step__main">
                <p className="fl-step__label mono">
                  {String(i + 1).padStart(2, "0")} · {label}
                </p>
                {state !== "next" && (
                  <StepBody
                    i={i}
                    lead={lead}
                    booked={booked}
                    elapsed={elapsed}
                    onBook={(slot) => {
                      setBooked(slot);
                      track("interaction_completed", { industry, action: "slot_booked" });
                    }}
                  />
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>

      <AnimatePresence>
        {done && (
          <motion.div className="flow__done" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
            <p>
              From first click to a booked {lead.appointment.toLowerCase()} — and nobody in your office typed a thing.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => {
                track("cta_clicked", { cta: "see_what_we_build", location: "flow" });
                set({ phase: "reveal" });
              }}
            >
              <span>See what VelaBuilt builds</span>
              <Arrow />
            </button>
            <div className="flow__again">
              <button type="button" className="link" onClick={() => set({ flowRun: useDemo.getState().flowRun + 1 })}>
                <Replay size={14} /> Replay
              </button>
              <button type="button" className="link" onClick={() => set({ phase: "explore" })}>
                Back to the {ind.short.toLowerCase()} demo
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!done && step < BOOK_STEP && (
        <button
          type="button"
          className="link flow__skip"
          onClick={() => {
            if (!booked) setBooked(upcomingSlots()[0].id);
            setElapsed(Math.max(2, Math.round((performance.now() - t0.current) / 1000)));
            setStep(STEPS.length);
          }}
        >
          Skip ahead
        </button>
      )}
    </motion.aside>
  );
}
