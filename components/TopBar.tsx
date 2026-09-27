"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import { INDUSTRIES, type IndustryId } from "@/lib/industries";
import { useDemo } from "@/lib/store";
import { IndustryIcon, Mark } from "./icons";

export function selectIndustry(id: IndustryId, source: string) {
  const s = useDemo.getState();
  if (s.phase === "intro" || s.phase === "loading") track("demo_started", { industry: id });
  s.selectIndustry(id);
  track("industry_selected", { industry: id, source });
}

export function Switcher() {
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [industry]);
  const visible = phase === "explore" || phase === "qualify";
  return (
    <nav className="switcher" data-visible={visible} aria-label="Choose a business">
      <div className="switcher__track" ref={ref}>
        {INDUSTRIES.map((i) => (
          <button
            key={i.id}
            type="button"
            className="switcher__item"
            aria-current={industry === i.id}
            onClick={() => {
              if (industry !== i.id) selectIndustry(i.id, "switcher");
              else useDemo.getState().setPhase("explore");
            }}
          >
            <IndustryIcon id={i.id} size={17} />
            <span>{i.short}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function TopBar() {
  const phase = useDemo((s) => s.phase);
  const company = useDemo((s) => s.company);
  const set = useDemo((s) => s.set);
  return (
    <header className="topbar" data-phase={phase}>
      <a className="brand" href="https://velabuilt.com" target="_blank" rel="noopener" onClick={() => track("cta_clicked", { cta: "brand", location: "topbar" })} aria-label="VelaBuilt (opens velabuilt.com)">
        <Mark size={30} />
        <span className="brand__name">VelaBuilt</span>
        <span className="brand__tag mono">The future of contractor sales{company ? ` · for ${company}` : ""}</span>
      </a>
      <Switcher />
      <button
        type="button"
        className="topbar__cta"
        onClick={() => {
          track("cta_clicked", { cta: "build_this", location: "topbar" });
          set({ leadFormOpen: true });
        }}
      >
        <span className="topbar__cta-long">Build this for my business</span>
        <span className="topbar__cta-short">Talk to us</span>
      </button>
    </header>
  );
}
