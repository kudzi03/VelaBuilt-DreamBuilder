"use client";

import { useMemo, useRef } from "react";
import { track } from "@/lib/analytics";
import { estimateFor, steelSchedule, upcomingSlots } from "@/lib/estimate";
import type { IndustryId } from "@/lib/industries";
import {
  CABINETS,
  COATINGS,
  COUNTERS,
  FLOORS,
  HVAC_ISSUE_BY_ID,
  HVAC_ISSUES,
  ISLANDS,
  KITCHEN_LED,
  OFFSETS,
  PANEL_FINISHES,
  ROOF_AGES,
  ROOF_ISSUES,
  ROOF_MATERIAL_BY_ID,
  ROOF_MATERIALS,
  SURFACES,
  SYSTEM_AGES,
  TRUSSES,
} from "@/lib/options";
import { PANEL, PANEL_CAPACITY, ROOF_AREA_M2, ROOF_PLANES } from "@/lib/spec";
import { KIND_LABEL, SECTIONS, buildFrame, memberLength, memberMassKg } from "@/lib/steel";
import { DEFAULTS, useDemo, type DemoState } from "@/lib/store";
import { area, detectUnits, length, mass, range } from "@/lib/units";
import { Close, Paperclip, Replay, Target } from "./icons";
import { Chips, Group, Slider, Swatches, Toggle } from "./ui";

function useChange<K extends IndustryId>(key: K) {
  const patch = useDemo((s) => s.patch);
  const setAnnounce = useDemo((s) => s.setAnnounce);
  return (value: Partial<DemoState[K]>, option: string, spoken?: string) => {
    patch(key, value);
    track("option_changed", { industry: key, option });
    if (spoken) setAnnounce(spoken);
  };
}

function CompareControl({ what }: { what: string }) {
  const compare = useDemo((s) => s.compare);
  const setCompare = useDemo((s) => s.setCompare);
  const industry = useDemo((s) => s.industry);
  return (
    <button
      type="button"
      className="compare-btn"
      data-on={compare}
      aria-pressed={compare}
      onClick={() => {
        setCompare(!compare);
        if (!compare) track("compare_used", { industry });
      }}
    >
      <span className="compare-btn__icon" aria-hidden>
        <span />
        <span />
      </span>
      <span>
        <strong>{compare ? "Hide before / after" : `Compare with the ${what}`}</strong>
        <small>{compare ? "Drag the handle across the scene" : "Before and after, side by side"}</small>
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- remodeling */

export function RemodelPanel() {
  const c = useDemo((s) => s.remodeling);
  const set = useChange("remodeling");
  return (
    <>
      <Group label="Cabinets" value={CABINETS.find((x) => x.id === c.cabinets)?.detail}>
        <Swatches label="Cabinets" options={CABINETS} value={c.cabinets} onChange={(v) => set({ cabinets: v }, "cabinets", `Cabinets: ${CABINETS.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Group label="Countertops">
        <Swatches label="Countertops" options={COUNTERS} value={c.counter} onChange={(v) => set({ counter: v }, "countertop", `Countertop: ${COUNTERS.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Group label="Flooring">
        <Swatches label="Flooring" options={FLOORS} value={c.floor} onChange={(v) => set({ floor: v }, "flooring", `Flooring: ${FLOORS.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Group label="Layout">
        <Chips label="Layout" options={ISLANDS} value={c.island} onChange={(v) => set({ island: v }, "layout", `Layout: ${ISLANDS.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Toggle label={KITCHEN_LED.label} detail={KITCHEN_LED.detail} checked={c.lighting} onChange={(v) => set({ lighting: v }, "lighting", v ? "LED lighting on" : "LED lighting off")} />
      <CompareControl what="old kitchen" />
    </>
  );
}

/* ------------------------------------------------------------------ roofing */

export function RoofPanel() {
  const c = useDemo((s) => s.roofing);
  const set = useChange("roofing");
  const units = detectUnits();
  const mat = ROOF_MATERIAL_BY_ID[c.material];
  const colors = mat.colors.map((x) => ({ id: x.id, label: x.label, swatch: x.hex }));
  return (
    <>
      <Group label="Roof" value={mat.life}>
        <Chips
          label="Roof material"
          options={ROOF_MATERIALS.map((m) => ({ id: m.id, label: m.label }))}
          value={c.material}
          onChange={(v) => set({ material: v, color: ROOF_MATERIAL_BY_ID[v].colors[0].id }, "roof_material", `Roof: ${ROOF_MATERIAL_BY_ID[v].label}`)}
        />
      </Group>
      <Group label="Colour">
        <Swatches label="Roof colour" options={colors} value={c.color} onChange={(v) => set({ color: v }, "roof_color", `Colour: ${colors.find((x) => x.id === v)?.label}`)} />
      </Group>

      <Group label="Where is the problem?" value={c.flags.length ? `${c.flags.length} marked` : undefined}>
        <button
          type="button"
          className="inspect-btn"
          data-on={c.inspect}
          aria-pressed={c.inspect}
          onClick={() => set({ inspect: !c.inspect, pending: null }, "inspect_mode")}
        >
          <Target size={18} />
          <span>
            <strong>{c.inspect ? "Tap the roof where you've seen trouble" : "Mark a problem on the roof"}</strong>
            <small>{c.inspect ? "Each mark goes to the roofer with the request" : "Leaks, ponding, storm damage"}</small>
          </span>
        </button>
        {c.pending && (
          <div className="pending" role="group" aria-label="What's wrong here?">
            <p className="pending__q">What&apos;s wrong on the {ROOF_PLANES.find((p) => p.id === c.pending?.section)?.short.toLowerCase()}?</p>
            <div className="chips">
              {ROOF_ISSUES.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    const pending = c.pending!;
                    set(
                      { flags: [...c.flags, { id: Date.now(), section: pending.section, issue: i.id, point: pending.point, normal: pending.normal }], pending: null },
                      "flag_added",
                      `Marked: ${i.label}`,
                    );
                  }}
                >
                  {i.label}
                </button>
              ))}
              <button type="button" className="chip chip--quiet" onClick={() => set({ pending: null }, "flag_cancel")}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {c.flags.length > 0 && (
          <ol className="flags">
            {c.flags.map((f, i) => (
              <li key={f.id}>
                <span className="flags__n">{i + 1}</span>
                <span>
                  {ROOF_ISSUES.find((x) => x.id === f.issue)?.label}
                  <small>{ROOF_PLANES.find((p) => p.id === f.section)?.label}</small>
                </span>
                <button type="button" aria-label={`Remove mark ${i + 1}`} onClick={() => set({ flags: c.flags.filter((x) => x.id !== f.id) }, "flag_removed")}>
                  <Close size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Group>

      <Group label="Measured from the model" value={area(ROOF_AREA_M2, units)}>
        <ul className="measure">
          {ROOF_PLANES.map((p) => (
            <li key={p.id}>
              <span>{p.label}</span>
              <span>{area(p.area, units)}</span>
            </li>
          ))}
        </ul>
      </Group>
      <CompareControl what="old roof" />
    </>
  );
}

/* -------------------------------------------------------------------- steel */

export function SteelPanel() {
  const c = useDemo((s) => s.steel);
  const set = useChange("steel");
  const units = detectUnits();
  const sch = steelSchedule(c.truss);
  const members = useMemo(() => buildFrame(c.truss), [c.truss]);
  const sel = c.selected ? members.find((m) => m.id === c.selected) : null;
  const fileRef = useRef<HTMLInputElement>(null);
  const secName = (id: keyof typeof SECTIONS) => (units === "imperial" ? SECTIONS[id].us.name : SECTIONS[id].metric.name);

  return (
    <>
      <Group label="Roof trusses" value={TRUSSES.find((t) => t.id === c.truss)?.detail}>
        <Chips label="Truss type" options={TRUSSES.map((t) => ({ id: t.id, label: t.label }))} value={c.truss} onChange={(v) => set({ truss: v, selected: null }, "truss", `Trusses: ${v}`)} />
      </Group>
      <Group label="Coating">
        <Swatches label="Coating" options={COATINGS} value={c.coating} onChange={(v) => set({ coating: v }, "coating", `Coating: ${COATINGS.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Group label="Assembly">
        <div className="row">
          <button type="button" className="chip" onClick={() => set({ replay: c.replay + 1, explode: 0 }, "replay_assembly")}>
            <Replay size={15} /> Replay erection sequence
          </button>
        </div>
        <div className="labelled-slider">
          <span>Explode</span>
          <Slider label="Explode the frame" min={0} max={1} step={0.01} value={c.explode} onChange={(v) => set({ explode: v }, "explode")} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <Toggle label="Show the building outline" checked={c.ghost} onChange={(v) => set({ ghost: v }, "ghost")} />
      </Group>

      <Group label={sel ? "Selected member" : "Inspect a member"} value={sel ? sel.id : undefined}>
        {sel ? (
          <div className="member">
            <p className="member__title">{sel.label}</p>
            <dl>
              <dt>Type</dt>
              <dd>{KIND_LABEL[sel.kind]}</dd>
              <dt>Section</dt>
              <dd>{secName(sel.section)}</dd>
              {sel.kind !== "plate" && (
                <>
                  <dt>Length</dt>
                  <dd>{length(memberLength(sel), units)}</dd>
                </>
              )}
              <dt>Mass</dt>
              <dd>{mass(memberMassKg(sel), units)}</dd>
              <dt>Grade</dt>
              <dd>{units === "imperial" ? "ASTM A992 / A500" : "S355JR"}</dd>
            </dl>
            <button type="button" className="link" onClick={() => set({ selected: null }, "member_clear")}>
              Clear selection
            </button>
          </div>
        ) : (
          <p className="muted small">Tap any column, beam or truss in the model to see its section, length and mass.</p>
        )}
      </Group>

      <Group label="Member schedule" value={`≈ ${mass(sch.totalKg, units)}`}>
        <table className="schedule">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Qty</th>
              <th scope="col">Mass</th>
            </tr>
          </thead>
          <tbody>
            {sch.rows.map((r) => (
              <tr key={`${r.kind}${r.section}`}>
                <td>
                  {KIND_LABEL[r.kind]}
                  <small>{secName(r.section)}</small>
                </td>
                <td>{r.count}</td>
                <td>{mass(r.mass, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Nominal section masses. A demonstration schedule, not a structural design.</p>
      </Group>

      <Group label="Drawings" value={c.files.length ? `${c.files.length} attached` : undefined}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.dwg,.dxf,.ifc,.png,.jpg,.jpeg"
          className="sr-only"
          id="drawings"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size, type: f.type || f.name.split(".").pop() || "" }));
            if (files.length) set({ files: [...c.files, ...files].slice(0, 6) }, "drawings_attached", `${files.length} drawing attached`);
            e.target.value = "";
          }}
        />
        <label htmlFor="drawings" className="upload">
          <Paperclip size={18} />
          <span>
            <strong>Attach drawings or specs</strong>
            <small>PDF, DWG, DXF, IFC or photos</small>
          </span>
        </label>
        {c.files.length > 0 && (
          <ul className="files">
            {c.files.map((f, i) => (
              <li key={`${f.name}${i}`}>
                <span>{f.name}</span>
                <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => set({ files: c.files.filter((_, j) => j !== i) }, "drawing_removed")}>
                  <Close size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Demo: files stay on this device. In a live build they go straight to your estimating inbox.</p>
      </Group>
    </>
  );
}

/* -------------------------------------------------------------------- solar */

export function SolarPanel() {
  const c = useDemo((s) => s.solar);
  const set = useChange("solar");
  const kw = ((c.panels * PANEL.watts) / 1000).toFixed(1);
  return (
    <>
      <Group label="How much should solar cover?">
        <Chips label="Coverage" options={OFFSETS} value={c.offset} onChange={(v) => set({ offset: v, panels: Math.min(PANEL_CAPACITY, OFFSETS.find((o) => o.id === v)!.panels) }, "offset")} />
      </Group>
      <Group label="System size" value={`${c.panels} panels · ${kw} kW`}>
        <Slider label="Number of panels" min={6} max={PANEL_CAPACITY} value={c.panels} onChange={(v) => set({ panels: v }, "panels")} format={(v) => `${v} panels`} />
        <p className="muted small">
          Laid out in rows on the flat roof, tilted to the sun and clear of the edges. This roof fits {PANEL_CAPACITY} panels.
        </p>
      </Group>
      <Group label="Panels">
        <Swatches label="Panel finish" options={PANEL_FINISHES} value={c.finish} onChange={(v) => set({ finish: v }, "finish")} />
      </Group>
      <Group label="Battery storage">
        <Chips
          label="Battery storage"
          options={[
            { id: 0, label: "None" },
            { id: 1, label: "1 battery" },
            { id: 2, label: "2 batteries" },
          ]}
          value={c.battery}
          onChange={(v) => set({ battery: v as 0 | 1 | 2 }, "battery")}
        />
      </Group>
      <Group label="About your home">
        <p className="q">Do you own the home?</p>
        <Chips
          label="Do you own the home?"
          compact
          options={[
            { id: "yes", label: "Yes" },
            { id: "no", label: "No, renting" },
          ]}
          value={c.owner}
          onChange={(v) => set({ owner: v as "yes" | "no" }, "owner")}
        />
        <p className="q">How old is the roof?</p>
        <Chips label="Roof age" compact options={ROOF_AGES} value={c.roofAge} onChange={(v) => set({ roofAge: v }, "roof_age")} />
      </Group>
      <p className="muted small">Illustrative layout. A site survey confirms shading, structure and expected output.</p>
    </>
  );
}

/* -------------------------------------------------------------- landscaping */

export function LandscapePanel() {
  const c = useDemo((s) => s.landscaping);
  const set = useChange("landscaping");
  return (
    <>
      <Group label="Terrace">
        <Swatches label="Terrace surface" options={SURFACES} value={c.surface} onChange={(v) => set({ surface: v }, "surface", `Terrace: ${SURFACES.find((x) => x.id === v)?.label}`)} />
      </Group>
      <Group label="Features">
        <Toggle label="Pergola" detail="Black steel, over the terrace" checked={c.pergola} onChange={(v) => set({ pergola: v }, "pergola")} />
        <Toggle label="Pool" detail="4 × 8 m, stone coping" checked={c.pool} onChange={(v) => set({ pool: v }, "pool")} />
      </Group>
      <Group label="Planting">
        <Chips
          label="Planting"
          options={[
            { id: "minimal", label: "Clean & minimal" },
            { id: "lush", label: "Layered & lush" },
          ]}
          value={c.planting}
          onChange={(v) => set({ planting: v as "minimal" | "lush" }, "planting")}
        />
      </Group>
      <Group label="Evening">
        <Toggle label="Garden lighting" detail="See it after dark" checked={c.evening} onChange={(v) => set({ evening: v }, "lighting", v ? "Evening view, lights on" : "Daytime view")} />
      </Group>
      <CompareControl what="garden as it is today" />
    </>
  );
}

/* --------------------------------------------------------------------- hvac */

export function HvacPanel() {
  const c = useDemo((s) => s.hvac);
  const set = useChange("hvac");
  const issue = HVAC_ISSUE_BY_ID[c.issue];
  const slots = useMemo(() => upcomingSlots(), []);
  return (
    <>
      <Group label="What's happening?">
        <Chips label="What's happening?" options={HVAC_ISSUES} value={c.issue} onChange={(v) => set({ issue: v }, "issue", HVAC_ISSUE_BY_ID[v].label)} />
        <div className="explain" aria-live="polite">
          <p>{issue.explain}</p>
          <ul>
            {issue.checks.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </Group>
      <Group label="Airflow">
        <Chips
          label="Airflow"
          compact
          options={[
            { id: "cool", label: "Cooling" },
            { id: "heat", label: "Heating" },
          ]}
          value={c.mode}
          onChange={(v) => set({ mode: v as "cool" | "heat" }, "mode")}
        />
      </Group>
      <Group label="Which part of the house?">
        <Chips
          label="Room"
          compact
          options={[
            { id: "upstairs", label: "Upstairs" },
            { id: "main", label: "Main floor" },
            { id: "kitchen", label: "Kitchen" },
          ]}
          value={c.zone}
          onChange={(v) => set({ zone: v as "upstairs" | "main" | "kitchen" }, "zone")}
        />
      </Group>
      <Group label="How old is the system?">
        <Chips label="System age" compact options={SYSTEM_AGES} value={c.age} onChange={(v) => set({ age: v }, "age")} />
      </Group>
      <Group label="Pick a visit" value={c.slot ? undefined : "Next 3 working days"}>
        <div className="slots" role="radiogroup" aria-label="Visit time">
          {slots.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={c.slot === s.id} className="slot" data-on={c.slot === s.id} onClick={() => set({ slot: s.id }, "slot")}>
              <span>{s.day}</span>
              <strong>{s.window}</strong>
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

export const PANELS: Record<IndustryId, () => React.JSX.Element> = {
  remodeling: RemodelPanel,
  roofing: RoofPanel,
  steel: SteelPanel,
  solar: SolarPanel,
  landscaping: LandscapePanel,
  hvac: HvacPanel,
};

export function EstimateLine({ industry }: { industry: IndustryId }) {
  const state = useDemo();
  const e = estimateFor(industry, state, detectUnits());
  return (
    <div className="estimate" aria-live="polite">
      <span className="estimate__label mono">{e.priceLabel ?? "Estimate"} · sample pricing</span>
      <strong className="estimate__value">{e.low === e.high ? (e.low === 0 ? "Free" : range(e.low, e.high).split(" – ")[0]) : range(e.low, e.high)}</strong>
      <span className="estimate__basis">{e.basis}</span>
    </div>
  );
}

export { DEFAULTS };
