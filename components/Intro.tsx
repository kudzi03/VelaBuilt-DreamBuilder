"use client";

import { AnimatePresence, motion } from "motion/react";
import { INDUSTRIES } from "@/lib/industries";
import { useDemo } from "@/lib/store";
import { IndustryIcon, Mark } from "./icons";
import { selectIndustry } from "./TopBar";

const EASE = [0.16, 1, 0.3, 1] as const;
const HEADLINE = "What if your customers could experience your work before they ever called you?";

export function Loader() {
  const phase = useDemo((s) => s.phase);
  const webgl = useDemo((s) => s.webgl);
  return (
    <AnimatePresence>
      {phase === "loading" && webgl && (
        <motion.div className="loader" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.9, ease: EASE } }} role="status" aria-live="polite">
          <Mark size={52} />
          <p className="mono">Building the property</p>
          <div className="loader__bar" aria-hidden>
            <span />
          </div>
          <span className="sr-only">Loading the interactive demo</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Intro() {
  const phase = useDemo((s) => s.phase);
  const company = useDemo((s) => s.company);
  const reduced = useDemo((s) => s.reducedMotion);
  const show = phase === "intro";
  const words = HEADLINE.split(" ");
  const d = reduced ? 0 : 1;
  return (
    <AnimatePresence>
      {show && (
        <motion.section className="intro" aria-labelledby="intro-title" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          <div className="intro__copy">
            <motion.p className="mono intro__eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 * d, duration: 0.8, ease: EASE }}>
              {company ? `Prepared for ${company}` : "Interactive demo · VelaBuilt"}
            </motion.p>
            <h1 id="intro-title" className="intro__title">
              {words.map((w, i) => (
                <motion.span
                  key={i}
                  className="intro__word"
                  initial={{ opacity: 0, y: reduced ? 0 : "0.35em", filter: reduced ? "none" : "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: (0.5 + i * 0.07) * d, duration: 0.9 * d + 0.01, ease: EASE }}
                >
                  {w}{" "}
                </motion.span>
              ))}
            </h1>
          </div>
          <motion.div className="intro__choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 * d, duration: 0.8 }}>
            <h2 className="intro__prompt">Choose a business.</h2>
            <ul className="cards" role="list">
              {INDUSTRIES.map((ind, i) => (
                <motion.li key={ind.id} initial={{ opacity: 0, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (2.1 + i * 0.07) * d, duration: 0.7, ease: EASE }}>
                  <button type="button" className="card" onClick={() => selectIndustry(ind.id, "intro")}>
                    <span className="card__icon">
                      <IndustryIcon id={ind.id} size={22} />
                    </span>
                    <span className="card__name">{ind.name}</span>
                    <span className="card__line">{ind.card}</span>
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
