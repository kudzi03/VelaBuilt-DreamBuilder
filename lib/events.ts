/** Allow-listed analytics events (shared by client and server). */
export const EVENTS = [
  "demo_loaded",
  "demo_started",
  "industry_selected",
  "option_changed",
  "compare_used",
  "interaction_completed",
  "business_flow_viewed",
  "business_flow_completed",
  "cta_clicked",
  "contact_started",
  "lead_submitted",
  "share_clicked",
] as const;

export type EventName = (typeof EVENTS)[number];
