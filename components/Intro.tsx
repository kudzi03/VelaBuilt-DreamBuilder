"use client";

import { AnimatePresence, motion } from "motion/react";
import { INDUSTRIES } from "@/lib/industries";
import { useDemo } from "@/lib/store";
import { Arrow, Mark } from "./icons";
import { selectIndustry } from "./TopBar";

const EASE = [0.16, 1, 0.3, 1] as const;
const HEADLINE = "What if your customers could experience your work before they ever called you?";

export function Loader() {
  const phase = useDemo((s) => s.phase);
  const webgl = useDemo((s) => s.webgl);
  const progress = useDemo((s) => s.loadProgress);
  const p = Math.min(100, Math.max(0, progress));
  return (
    <AnimatePresence>
      {phase === "loading" && webgl && (
        <motion.div className="loader" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 1.1, ease: EASE } }} role="status" aria-live="polite">
          {/* the property drawn in elevation while it loads */}
          <svg className="loader__house" viewBox="0 0 260 124" aria-hidden>
            <path className="loader__ground" d="M4 108 H256" />
            <path className="loader__line" d="M40 108 V58 L96 20 L152 58 V108" />
            <path className="loader__line loader__line--2" d="M152 108 V76 L192 56 L232 76 V108" />
            <path className="loader__line loader__line--3" d="M56 108 V74 H88 V108 M110 60 H138 V88 H110 Z M168 108 V82 H218 V108" />
          </svg>
          <div className="loader__meta">
            <Mark size={20} />
            <p className="mono">Building the property</p>
            <span className="mono loader__pct">{String(Math.round(p)).padStart(2, "0")}%</span>
          </div>
          <div className="loader__bar" aria-hidden>
            <span style={{ transform: `scaleX(${Math.max(0.03, p / 100)})` }} />
          </div>
          <span className="sr-only">Loading the interactive demo</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The headline, split into words for the entrance; `em` marks the phrase set in italic. */
const WORDS: { w: string; em?: boolean }[] = [
  { w: "What" },
  { w: "if" },
  { w: "your" },
  { w: "customers" },
  { w: "could" },
  { w: "experience", em: true },
  { w: "your", em: true },
  { w: "work", em: true },
  { w: "before" },
  { w: "they" },
  { w: "ever" },
  { w: "called" },
  { w: "you?" },
];
const SUPPORT = "Interactive experiences, AI automation and sales systems for contractors, manufacturers and construction businesses.";

export function Intro() {
  const phase = useDemo((s) => s.phase);
  const company = useDemo((s) => s.company);
  const reduced = useDemo((s) => s.reducedMotion);
  const webgl = useDemo((s) => s.webgl);
  const show = phase === "intro";
  const d = reduced ? 0 : 1;
  return (
    <AnimatePresence>
      {show && (
        <motion.section className="intro" id="main-content" tabIndex={-1} aria-labelledby="intro-title" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          <motion.div className="intro__scrim" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6 * d + 0.01, ease: EASE }} />
          <div className="intro__copy">
            <motion.p className="mono intro__eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 * d, duration: 0.8, ease: EASE }}>
              {company ? `Prepared for ${company}` : "VelaBuilt · Interactive demo"}
            </motion.p>
            <h1 id="intro-title" className="intro__title" aria-label={HEADLINE}>
              {WORDS.map(({ w, em }, i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className={`intro__word${em ? " intro__word--em" : ""}`}
                  initial={{ opacity: 0, y: reduced ? 0 : "0.3em", filter: reduced ? "none" : "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: (0.5 + i * 0.065) * d, duration: 1.0 * d + 0.01, ease: EASE }}
                >
                  {w}{" "}
                </motion.span>
              ))}
            </h1>
            <motion.p className="intro__lede" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.45 * d, duration: 0.9, ease: EASE }}>
              {SUPPORT}
            </motion.p>
            {!webgl && (
              <p className="intro__note" role="note">
                This device can&apos;t show the 3D view, so you&apos;ll see stills. Everything else works: pick a business, configure it, and watch the lead come through.
              </p>
            )}
          </div>
          <motion.div className="intro__choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 * d, duration: 0.8 }}>
            <h2 className="intro__prompt">
              <span className="mono">Choose a business</span>
              <span className="intro__rule" aria-hidden />
              <span className="intro__count mono" aria-hidden>
                06
              </span>
            </h2>
            <ul className="reel" role="list">
              {INDUSTRIES.map((ind, i) => (
                <motion.li key={ind.id} initial={{ opacity: 0, y: reduced ? 0 : 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (2.05 + i * 0.08) * d, duration: 0.9, ease: EASE }}>
                  <button type="button" className="tile" onClick={() => selectIndustry(ind.id, "intro")}>
                    <span className="tile__img" style={{ backgroundImage: `url(/previews/${ind.id}.webp)` }} aria-hidden />
                    <span className="tile__shade" aria-hidden />
                    <span className="tile__index mono" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="tile__meta">
                      <span className="tile__name">{ind.name}</span>
                      <span className="tile__line">{ind.card}</span>
                    </span>
                    <span className="tile__go" aria-hidden>
                      <Arrow size={16} />
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
