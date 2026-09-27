import type { IndustryId } from "./industries";
import {
  BATTERY_EACH,
  CABINETS,
  COATINGS,
  COUNTERS,
  FLOORS,
  HVAC_ISSUE_BY_ID,
  HVAC_REPLACEMENT,
  ISLANDS,
  LANDSCAPE_LAWN,
  LANDSCAPE_LIGHTING,
  LANDSCAPE_PERGOLA,
  LANDSCAPE_PLANTING,
  LANDSCAPE_POOL,
  PANEL_FINISHES,
  REMODEL_BASE,
  ROOF_FLASHING,
  ROOF_ISSUES,
  ROOF_MATERIAL_BY_ID,
  ROOF_TEAROFF_PER_SQUARE,
  SOLAR_PER_WATT,
  STEEL_FAB_PER_TONNE,
  SURFACES,
  TRUSSES,
} from "./options";
import { PANEL, PATIO_AREA_M2, ROOF_AREA_M2, ROOF_PLANE_BY_ID } from "./spec";
import { buildFrame, schedule } from "./steel";
import type { DemoState } from "./store";
import { area, mass, roofSquares, type UnitSystem } from "./units";

export interface Estimate {
  low: number;
  high: number;
  /** what the price covers, short */
  basis: string;
  /** the configuration, as label/value pairs (these become CRM fields) */
  spec: Array<[string, string]>;
  /** extras for the CRM record: flags, attachments, notes */
  notes: string[];
  /** e.g. "No price shown" for free visits */
  priceLabel?: string;
}

const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];
const find = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id) ?? list[0];

const frameCache = new Map<string, ReturnType<typeof schedule>>();
export function steelSchedule(truss: DemoState["steel"]["truss"]) {
  let s = frameCache.get(truss);
  if (!s) {
    s = schedule(buildFrame(truss));
    frameCache.set(truss, s);
  }
  return s;
}

export function estimateFor(id: IndustryId, s: DemoState, units: UnitSystem): Estimate {
  switch (id) {
    case "remodeling": {
      const c = s.remodeling;
      const cab = find(CABINETS, c.cabinets);
      const top = find(COUNTERS, c.counter);
      const fl = find(FLOORS, c.floor);
      const isl = find(ISLANDS, c.island);
      let r: [number, number] = REMODEL_BASE;
      for (const p of [cab.price, top.price, fl.price, isl.price]) if (p) r = add(r, p);
      return {
        low: r[0],
        high: r[1],
        basis: "Design, demolition, cabinets, tops, flooring, install",
        spec: [
          ["Cabinets", `${cab.detail} · ${cab.label}`],
          ["Countertops", top.label],
          ["Flooring", fl.label],
          ["Layout", isl.label],
        ],
        notes: [],
      };
    }
    case "roofing": {
      const c = s.roofing;
      const mat = ROOF_MATERIAL_BY_ID[c.material];
      const color = mat.colors.find((x) => x.id === c.color) ?? mat.colors[0];
      const squares = roofSquares(ROOF_AREA_M2) * 1.1; // 10% waste
      const low = squares * (mat.perSquare[0] + ROOF_TEAROFF_PER_SQUARE[0]) + ROOF_FLASHING[0];
      const high = squares * (mat.perSquare[1] + ROOF_TEAROFF_PER_SQUARE[1]) + ROOF_FLASHING[1];
      const notes = c.flags.map((f, i) => {
        const issue = ROOF_ISSUES.find((x) => x.id === f.issue)?.label ?? f.issue;
        return `Flag ${i + 1}: ${issue} — ${ROOF_PLANE_BY_ID[f.section].short.toLowerCase()}`;
      });
      return {
        low,
        high,
        basis: `Tear-off, underlayment, ${mat.label.toLowerCase()}, flashing`,
        spec: [
          ["Roof", `${mat.label} · ${color.label}`],
          ["Roof area", `${area(ROOF_AREA_M2, units)}${units === "imperial" ? ` · ${roofSquares(ROOF_AREA_M2).toFixed(1)} squares` : ""}`],
          ["Problem areas", c.flags.length ? `${c.flags.length} marked by customer` : "None marked"],
        ],
        notes,
      };
    }
    case "steel": {
      const c = s.steel;
      const sch = steelSchedule(c.truss);
      const t = sch.totalKg / 1000;
      const coat = find(COATINGS, c.coating);
      const low = t * (STEEL_FAB_PER_TONNE[0] + coat.perTonne[0]);
      const high = t * (STEEL_FAB_PER_TONNE[1] + coat.perTonne[1]);
      const truss = TRUSSES.find((x) => x.id === c.truss) ?? TRUSSES[0];
      return {
        low,
        high,
        basis: "Supply, fabricate and coat. Erection quoted separately",
        spec: [
          ["Frame", `${sch.count} members · ≈ ${mass(sch.totalKg, units)}`],
          ["Roof trusses", `7 × ${truss.label}`],
          ["Coating", coat.label],
          ["Drawings", c.files.length ? c.files.map((f) => f.name).join(", ") : "Not attached"],
        ],
        notes: c.files.length ? [`${c.files.length} drawing file${c.files.length > 1 ? "s" : ""} attached for take-off`] : [],
      };
    }
    case "solar": {
      const c = s.solar;
      const w = c.panels * PANEL.watts;
      const low = w * SOLAR_PER_WATT[0] + c.battery * BATTERY_EACH[0];
      const high = w * SOLAR_PER_WATT[1] + c.battery * BATTERY_EACH[1];
      const finish = find(PANEL_FINISHES, c.finish);
      const notes: string[] = [];
      if (c.roofAge === "20+") notes.push("Roof 20+ years old — suggest a roof inspection before install");
      if (c.owner === "no") notes.push("Customer rents — landlord approval needed");
      return {
        low,
        high,
        basis: "Panels, inverter, racking, install" + (c.battery ? ", battery" : ""),
        spec: [
          ["System", `${c.panels} panels · ${(w / 1000).toFixed(1)} kW (nominal)`],
          ["Panels", `${finish.label} · ${PANEL.watts} W`],
          ["Battery", c.battery ? `${c.battery} × home battery` : "None"],
          ["Homeowner", c.owner === "yes" ? "Yes" : c.owner === "no" ? "No (renting)" : "Not answered"],
          ["Roof age", c.roofAge ? (c.roofAge === "unsure" ? "Not sure" : `${c.roofAge} yrs`) : "Not answered"],
        ],
        notes,
      };
    }
    case "landscaping": {
      const c = s.landscaping;
      const surf = find(SURFACES, c.surface);
      let r: [number, number] = LANDSCAPE_LAWN;
      if (surf.price) r = add(r, surf.price);
      if (c.pergola) r = add(r, LANDSCAPE_PERGOLA);
      if (c.pool) r = add(r, LANDSCAPE_POOL);
      r = add(r, LANDSCAPE_PLANTING[c.planting]);
      if (c.evening) r = add(r, LANDSCAPE_LIGHTING);
      const features = [c.pergola && "pergola", c.pool && "pool", c.evening && "lighting"].filter(Boolean).join(", ");
      return {
        low: r[0],
        high: r[1],
        basis: "Design, groundwork, materials, planting, install",
        spec: [
          ["Terrace", c.surface === "lawn" ? "Lawn to the door" : `${surf.label} · ${area(PATIO_AREA_M2, units)}`],
          ["Features", features ? features[0].toUpperCase() + features.slice(1) : "None"],
          ["Planting", c.planting === "lush" ? "Layered, lush" : "Minimal"],
          ["Lighting", c.evening ? "Path, tree and pergola lighting" : "Not included"],
        ],
        notes: [],
      };
    }
    case "hvac": {
      const c = s.hvac;
      const issue = HVAC_ISSUE_BY_ID[c.issue];
      const replace = c.issue === "replace";
      return {
        low: replace ? HVAC_REPLACEMENT[0] : issue.visit[0],
        high: replace ? HVAC_REPLACEMENT[1] : issue.visit[1],
        basis: replace ? "Typical replacement range — confirmed at the free estimate" : `${issue.visitLabel}. Repairs quoted on site before any work`,
        priceLabel: replace ? "Replacement range" : issue.visitLabel,
        spec: [
          ["Problem", issue.label],
          ["System age", c.age ? `${c.age} yrs` : "Not answered"],
          ["Room noted", c.zone ? { upstairs: "Upstairs bedrooms", main: "Main floor", kitchen: "Kitchen & dining" }[c.zone] : "None"],
          ["Visit", c.slot ? formatSlot(c.slot) : "Not chosen"],
        ],
        notes: c.age === "15+" ? ["System 15+ years old — include replacement options"] : [],
      };
    }
  }
}

export interface Slot {
  id: string;
  day: string;
  window: string;
}

/** Next three working days, two windows each — computed from today, never hardcoded. */
export function upcomingSlots(from = new Date()): Slot[] {
  const out: Slot[] = [];
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  while (out.length < 6) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const iso = d.toISOString().slice(0, 10);
    out.push({ id: `${iso}T08`, day, window: "8 – 12" });
    out.push({ id: `${iso}T13`, day, window: "1 – 5" });
  }
  return out;
}

export function formatSlot(id: string): string {
  const [date, hour] = id.split("T");
  const d = new Date(`${date}T12:00:00`);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `${day}, ${hour === "08" ? "8 am – 12 pm" : "1 – 5 pm"}`;
}
