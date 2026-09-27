"use client";

import { useEffect, useRef } from "react";

/**
 * A spec label on a leader line: a point on the model, a hairline up, the label above.
 * Shared by the engineering views (steel, HVAC). Styles: `.callout` in app/ui.css.
 * The label reads to the right of its leader, or to the left when that would run off screen.
 */
export function Callout({ k, v, tone }: { k: string; v: string; tone?: "warm" | "cool" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const box = el?.lastElementChild as HTMLElement | null;
      if (el && box) {
        // the callout itself is a zero-size point at the anchor: flipping the label never moves it
        const x = el.getBoundingClientRect().left;
        const flip = x + box.offsetWidth > window.innerWidth - 10 && x - box.offsetWidth > 10;
        if ((el.dataset.flip === "1") !== flip) el.dataset.flip = flip ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className={`callout${tone ? ` callout--${tone}` : ""}`} data-flip="0">
      <span className="callout__dot" />
      <span className="callout__line" />
      <span className="callout__box">
        <span className="callout__k">{k}</span>
        <span className="callout__v">{v}</span>
      </span>
    </div>
  );
}
