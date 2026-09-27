"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "./icons";

export interface Opt<T extends string | number = string> {
  id: T;
  label: string;
  detail?: string;
  swatch?: string;
  disabled?: boolean;
}

function useRovingKeys<T extends string | number>(options: Opt<T>[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = options.findIndex((o) => o.id === value);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % options.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + options.length) % options.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = options.length - 1;
    if (n >= 0) {
      e.preventDefault();
      onChange(options[n].id);
      refs.current[n]?.focus();
    }
  };
  return { refs, onKeyDown };
}

export function Group({ label, value, children, aside }: { label: string; value?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section className="group" aria-labelledby={id}>
      <div className="group__head">
        <h3 id={id} className="group__label">
          {label}
        </h3>
        {value != null && <span className="group__value">{value}</span>}
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Swatches<T extends string>({ label, options, value, onChange, size = "md" }: { label: string; options: Opt<T>[]; value: T; onChange: (v: T) => void; size?: "md" | "lg" }) {
  const { refs, onKeyDown } = useRovingKeys(options, value, onChange);
  return (
    <div className={`swatches swatches--${size}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.detail ? `${o.label}, ${o.detail}` : o.label}
            tabIndex={on ? 0 : -1}
            className="swatch"
            data-on={on}
            onClick={() => onChange(o.id)}
            onKeyDown={onKeyDown}
          >
            <span className="swatch__chip" style={{ background: o.swatch }}>
              {on && <Check size={14} className="swatch__check" />}
            </span>
            <span className="swatch__label">{o.label}</span>
            {o.detail && <span className="swatch__detail">{o.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Chips<T extends string | number>({ label, options, value, onChange, wrap = true, compact }: { label: string; options: Opt<T>[]; value: T | null; onChange: (v: T) => void; wrap?: boolean; compact?: boolean }) {
  const { refs, onKeyDown } = useRovingKeys(options, (value ?? options[0].id) as T, onChange);
  return (
    <div className={`chips ${wrap ? "" : "chips--row"} ${compact ? "chips--compact" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={String(o.id)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value == null && i === 0) ? 0 : -1}
            className="chip"
            data-on={on}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            onKeyDown={onKeyDown}
          >
            {o.label}
            {o.detail && <small>{o.detail}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" data-on={checked} onClick={() => onChange(!checked)}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {detail && <span className="toggle__detail">{detail}</span>}
      </span>
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
    </button>
  );
}

export function Slider({ label, min, max, step = 1, value, onChange, format }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="sr-only">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format ? format(value) : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--pct" as string]: `${pct}%` }}
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  icon,
  type = "button",
  disabled,
  href,
  className = "",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "gold";
  icon?: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  href?: string;
  className?: string;
  target?: string;
  rel?: string;
  "aria-describedby"?: string;
}) {
  const cls = `btn btn--${variant} ${className}`;
  if (href)
    return (
      <a className={cls} href={href} onClick={onClick} {...rest}>
        <span>{children}</span>
        {icon}
      </a>
    );
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} {...rest}>
      <span>{children}</span>
      {icon}
    </button>
  );
}
