"use client";

/**
 * A spec label on a leader line: a point on the model, a hairline up, the label above.
 * Shared by the engineering views (steel, HVAC). Styles: `.callout` in app/ui.css.
 */
export function Callout({ k, v, tone }: { k: string; v: string; tone?: "warm" | "cool" }) {
  return (
    <div className={`callout${tone ? ` callout--${tone}` : ""}`}>
      <span className="callout__dot" />
      <span className="callout__line" />
      <span className="callout__box">
        <span className="callout__k">{k}</span>
        <span className="callout__v">{v}</span>
      </span>
    </div>
  );
}
