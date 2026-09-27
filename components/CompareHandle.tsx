"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useDemo } from "@/lib/store";
import { Drag } from "./icons";

export function CompareHandle() {
  const compare = useDemo((s) => s.compare);
  const phase = useDemo((s) => s.phase);
  const split = useDemo((s) => s.split);
  const setSplit = useDemo((s) => s.setSplit);
  const insets = useDemo((s) => s.insets);
  const dragging = useRef(false);
  const on = compare && phase === "explore";

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setSplit(e.clientX / window.innerWidth);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setSplit(split - 0.03);
    else if (e.key === "ArrowRight") setSplit(split + 0.03);
    else if (e.key === "Home") setSplit(0.03);
    else if (e.key === "End") setSplit(0.97);
    else return;
    e.preventDefault();
  };

  return (
    <AnimatePresence>
      {on && (
        <motion.div
          className="compare"
          style={{ left: `${split * 100}%`, top: insets.top, bottom: insets.bottom }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <span className="compare__line" aria-hidden />
          <span className="compare__tag compare__tag--before mono" aria-hidden>
            Before
          </span>
          <span className="compare__tag compare__tag--after mono" aria-hidden>
            After
          </span>
          <div
            className="compare__knob"
            role="slider"
            tabIndex={0}
            aria-label="Before and after divider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            aria-valuetext={`${Math.round(split * 100)}% before`}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            onKeyDown={key}
          >
            <Drag size={18} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
