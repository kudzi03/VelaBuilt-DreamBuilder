export type IndustryId = "remodeling" | "roofing" | "steel" | "solar" | "landscaping" | "hvac";

export interface Industry {
  id: IndustryId;
  name: string;
  short: string;
  card: string;
  /** Panel heading — written in the customer's voice */
  title: string;
  /** One line: what the customer is doing */
  customer: string;
  cta: string;
  /** How the lead is labelled in the CRM */
  source: string;
  /** What the business books */
  appointment: string;
  /** Default placeholder business name when none is supplied */
  placeholder: string;
  /** What the job turns into */
  job: string;
}

export const INDUSTRIES: Industry[] = [
  {
    id: "remodeling",
    name: "Remodeling",
    short: "Remodel",
    card: "Kitchens, bathrooms, whole-home",
    title: "Design your new kitchen",
    customer: "Your customer designs the kitchen and watches the price move as they choose.",
    cta: "Get my kitchen estimate",
    source: "3D kitchen designer",
    appointment: "In-home design consultation",
    placeholder: "Your Remodeling Co.",
    job: "Kitchen remodel",
  },
  {
    id: "roofing",
    name: "Roofing",
    short: "Roofing",
    card: "Replacement, repair, inspection",
    title: "Choose your new roof",
    customer: "Your customer puts a new roof on the house, then marks where the old one is failing.",
    cta: "Request free inspection",
    source: "3D roof visualiser",
    appointment: "Free roof inspection",
    placeholder: "Your Roofing Co.",
    job: "Roof replacement",
  },
  {
    id: "steel",
    name: "Structural Steel",
    short: "Steel",
    card: "Fabrication, frames, trusses",
    title: "Specify the steel frame",
    customer: "Your client inspects the frame member by member, then sends drawings for a quote.",
    cta: "Request fabrication quote",
    source: "3D frame configurator",
    appointment: "Technical review call",
    placeholder: "Your Engineering Co.",
    job: "Fabrication order",
  },
  {
    id: "solar",
    name: "Solar",
    short: "Solar",
    card: "Panels, batteries, installation",
    title: "Design your solar system",
    customer: "Your customer sees panels laid out on their own roof, then tells you whether they're ready.",
    cta: "Get my solar design",
    source: "3D solar designer",
    appointment: "Site survey",
    placeholder: "Your Solar Co.",
    job: "Solar installation",
  },
  {
    id: "landscaping",
    name: "Outdoor Living",
    short: "Outdoor",
    card: "Landscaping, decks, pools, lighting",
    title: "Plan your garden",
    customer: "Your customer builds the garden they want, then switches the lights on.",
    cta: "Book a design consultation",
    source: "3D garden planner",
    appointment: "Garden design consultation",
    placeholder: "Your Landscaping Co.",
    job: "Outdoor living build",
  },
  {
    id: "hvac",
    name: "HVAC & Home Services",
    short: "HVAC",
    card: "Service, repair, replacement",
    title: "What's happening at home?",
    customer: "Your customer sees what's wrong, understands the fix, and books the visit.",
    cta: "Book a technician",
    source: "3D home comfort check",
    appointment: "Service visit",
    placeholder: "Your Heating & Air Co.",
    job: "Service call",
  },
];

export const INDUSTRY_BY_ID = Object.fromEntries(INDUSTRIES.map((i) => [i.id, i])) as Record<IndustryId, Industry>;

export function isIndustryId(v: unknown): v is IndustryId {
  return typeof v === "string" && v in INDUSTRY_BY_ID;
}
