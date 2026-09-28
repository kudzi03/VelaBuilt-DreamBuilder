import { estimateFor, formatSlot, steelSchedule } from "./estimate";
import { INDUSTRY_BY_ID, type IndustryId } from "./industries";
import { CABINETS, CHANNELS, COUNTERS, FLOORS, HVAC_ISSUE_BY_ID, ROOF_MATERIAL_BY_ID, TIMELINES } from "./options";
import { PANEL, ROOF_AREA_M2 } from "./spec";
import type { DemoState } from "./store";
import { isAfricaZone, mass, range, roofSquares, type UnitSystem } from "./units";

const NAMES_US = ["Sarah Mitchell", "Daniel Brooks", "Emily Carter", "Michael Reyes", "Laura Bennett"];
const NAMES_AF = ["Tendai Moyo", "Rutendo Ncube", "Tapiwa Dube", "Nomsa Khumalo", "Farai Chikomo"];

let sample = "";
export function sampleName(): string {
  if (!sample) {
    const list = isAfricaZone() ? NAMES_AF : NAMES_US;
    sample = list[Math.floor(Math.random() * list.length)];
  }
  return sample;
}

export interface Reason {
  points: number;
  text: string;
}

export interface Lead {
  industry: IndustryId;
  name: string;
  first: string;
  company: string;
  source: string;
  project: string;
  spec: Array<[string, string]>;
  estimate: string;
  notes: string[];
  timeline: string;
  channel: string;
  score: number;
  band: "Hot" | "Warm" | "Nurture";
  reasons: Reason[];
  message: string;
  appointment: string;
  job: string;
  explored: string;
  choices: number;
}

function fmtDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

export function buildLead(id: IndustryId, s: DemoState, units: UnitSystem): Lead {
  const ind = INDUSTRY_BY_ID[id];
  const est = estimateFor(id, s, units);
  const eng = s.engagement[id] ?? { ms: 0, actions: 0, compare: false };
  const liveMs = s.industry === id && s.enteredAt ? performance.now() - s.enteredAt : 0;
  const ms = eng.ms + liveMs;
  const name = (s.qualification.name || sampleName()).trim();
  const first = name.split(" ")[0];
  const company = s.company || ind.placeholder;
  // "it's Acme Co." — never "Acme Co.." when the name already ends in a full stop
  const signed = `${company.replace(/\.+$/, "")}.`;
  const q = s.qualification;
  const rangeText = est.low === est.high ? (est.low === 0 ? "free" : range(est.low, est.high).split(" – ")[0]) : range(est.low, est.high);

  const reasons: Reason[] = [];
  if (ms > 20000) reasons.push({ points: 10, text: `Spent ${fmtDuration(ms)} designing it` });
  else reasons.push({ points: 5, text: "Explored the 3D model" });
  if (eng.actions >= 3) reasons.push({ points: 10, text: `Made ${eng.actions} choices` });
  if (q.timeline === "asap") reasons.push({ points: 25, text: "Wants it done as soon as possible" });
  if (q.timeline === "1-3m") reasons.push({ points: 20, text: "Ready within 3 months" });
  if (q.timeline === "3-6m") reasons.push({ points: 10, text: "Planning for 3–6 months" });
  if (q.timeline === "research") reasons.push({ points: 0, text: "Researching — goes to a nurture sequence" });
  if (q.channel) reasons.push({ points: 5, text: `Prefers ${CHANNELS.find((c) => c.id === q.channel)?.label}` });
  reasons.push({ points: 10, text: `Saw ${est.low === 0 && est.high === 0 ? "the price" : rangeText} and still asked` });

  switch (id) {
    case "roofing":
      if (s.roofing.flags.length) reasons.push({ points: 15, text: `Marked ${s.roofing.flags.length} problem area${s.roofing.flags.length > 1 ? "s" : ""} on the roof` });
      break;
    case "solar":
      if (s.solar.owner === "yes") reasons.push({ points: 20, text: "Homeowner" });
      if (s.solar.owner === "no") reasons.push({ points: -10, text: "Renting — needs landlord approval" });
      if (s.solar.battery) reasons.push({ points: 5, text: "Wants battery storage" });
      break;
    case "steel":
      if (s.steel.files.length) reasons.push({ points: 20, text: "Drawings attached for take-off" });
      break;
    case "hvac":
      if (s.hvac.issue === "cooling" || s.hvac.issue === "noise") reasons.push({ points: 15, text: "Active problem — time-sensitive" });
      if (s.hvac.age === "15+") reasons.push({ points: 10, text: "System 15+ years old — replacement likely" });
      if (s.hvac.slot) reasons.push({ points: 10, text: "Already picked a visit time" });
      break;
    case "remodeling":
      if (est.high > 45000) reasons.push({ points: 10, text: "High-value project" });
      break;
    case "landscaping":
      if (s.landscaping.pool) reasons.push({ points: 15, text: "Pool — high-value project" });
      break;
  }

  const score = Math.max(12, Math.min(97, reasons.reduce((a, r) => a + r.points, 18)));
  const band = score >= 75 ? "Hot" : score >= 50 ? "Warm" : "Nurture";

  let message = "";
  let job = "";
  switch (id) {
    case "roofing": {
      const m = ROOF_MATERIAL_BY_ID[s.roofing.material];
      const col = m.colors.find((c) => c.id === s.roofing.color)?.label ?? "";
      const n = s.roofing.flags.length;
      message = `Hi ${first}, it's ${signed} Thanks for choosing your new roof on our site — ${m.label.toLowerCase()} in ${col.toLowerCase()}, estimated at ${rangeText}.${n ? ` We've noted the ${n} area${n > 1 ? "s" : ""} you marked.` : ""} When can we come by for the free inspection?`;
      job = `Roof replacement · ${m.label}, ${col} · ${roofSquares(ROOF_AREA_M2).toFixed(1)} squares · materials list ready`;
      break;
    }
    case "remodeling": {
      const cab = CABINETS.find((x) => x.id === s.remodeling.cabinets)!;
      const top = COUNTERS.find((x) => x.id === s.remodeling.counter)!;
      const fl = FLOORS.find((x) => x.id === s.remodeling.floor)!;
      message = `Hi ${first}, it's ${signed} Love the kitchen you designed — ${cab.label.toLowerCase()} ${cab.detail?.toLowerCase()} cabinets with ${top.label.toLowerCase()}, around ${rangeText}. Want to walk through it together at home?`;
      job = `Kitchen remodel · order list drafted: ${cab.label} ${cab.detail}, ${top.label}, ${fl.label}${s.remodeling.lighting ? ", LED strip kit" : ""}`;
      break;
    }
    case "steel": {
      const sch = steelSchedule(s.steel.truss);
      message = `Hello ${first}, ${company} here. We've received your frame spec${s.steel.files.length ? " and drawings" : ""} — ${sch.count} members, about ${mass(sch.totalKg, units)}. Our estimator can go through it with you this week. Which time suits?`;
      job = `Fabrication order · ${sch.count} members · cutting list and shop-drawing queue generated`;
      break;
    }
    case "solar": {
      const kw = ((s.solar.panels * PANEL.watts) / 1000).toFixed(1);
      message = `Hi ${first}, it's ${signed} Thanks for designing your ${kw} kW system — ${s.solar.panels} panels${s.solar.battery ? ` and ${s.solar.battery} batter${s.solar.battery > 1 ? "ies" : "y"}` : ""}, estimated at ${rangeText}. Next step is a quick site survey. When works?`;
      job = `Solar installation · ${s.solar.panels} × ${PANEL.watts} W${s.solar.battery ? ` + ${s.solar.battery} battery` : ""} · permit pack started`;
      break;
    }
    case "landscaping": {
      const f = [s.landscaping.pool && "pool", s.landscaping.pergola && "pergola", s.landscaping.evening && "lighting"].filter(Boolean).join(", ");
      message = `Hi ${first}, it's ${signed} Your garden plan looks great${f ? ` — ${f}` : ""}, estimated at ${rangeText}. Can we walk the space with you and refine it?`;
      job = `Outdoor living build · ${f || "terrace and planting"} · planting plan ready`;
      break;
    }
    case "hvac": {
      const iss = HVAC_ISSUE_BY_ID[s.hvac.issue];
      message = s.hvac.slot
        ? `Hi ${first}, it's ${signed} You're booked for ${formatSlot(s.hvac.slot)} — "${iss.label.toLowerCase()}". Your technician will text when they're on the way.`
        : `Hi ${first}, it's ${signed} We've got your request — "${iss.label.toLowerCase()}". Pick a time and we'll send a technician.`;
      job = `Service call · ${iss.label} · technician assigned, parts checklist attached`;
      break;
    }
  }

  return {
    industry: id,
    name,
    first,
    company,
    source: ind.source,
    project: ind.job,
    spec: est.spec,
    estimate: rangeText,
    notes: est.notes,
    timeline: TIMELINES.find((t) => t.id === q.timeline)?.label ?? "Not given",
    channel: CHANNELS.find((c) => c.id === q.channel)?.label ?? "Not given",
    score,
    band,
    reasons,
    message,
    appointment: ind.appointment,
    job,
    explored: fmtDuration(ms),
    choices: eng.actions,
  };
}
