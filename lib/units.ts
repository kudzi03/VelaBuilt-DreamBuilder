export type UnitSystem = "metric" | "imperial";

const US_ZONES = /^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Boise|Indiana|Kentucky|North_Dakota|Menominee|Juneau|Sitka|Nome|Adak|Metlakatla|Yakutat)|Pacific\/Honolulu|US\/)/;

let cached: UnitSystem | null = null;

/** Imperial only for visitors in US time zones. Everyone else sees metric. */
export function detectUnits(): UnitSystem {
  if (cached) return cached;
  if (typeof window === "undefined") return "metric";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    cached = US_ZONES.test(tz) ? "imperial" : "metric";
  } catch {
    cached = "metric";
  }
  return cached;
}

export function isAfricaZone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (Intl.DateTimeFormat().resolvedOptions().timeZone || "").startsWith("Africa/");
  } catch {
    return false;
  }
}

const M2_TO_FT2 = 10.7639;

export function area(m2: number, units: UnitSystem): string {
  if (units === "imperial") return `${Math.round(m2 * M2_TO_FT2).toLocaleString("en-US")} sq ft`;
  return `${m2.toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`;
}

export function roofSquares(m2: number): number {
  return (m2 * M2_TO_FT2) / 100;
}

export function length(m: number, units: UnitSystem): string {
  if (units === "imperial") {
    const ft = m * 3.28084;
    return ft >= 10 ? `${Math.round(ft)} ft` : `${ft.toFixed(1)} ft`;
  }
  return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`;
}

export function mass(kg: number, units: UnitSystem): string {
  if (units === "imperial") {
    const lb = kg * 2.20462;
    return lb >= 4000 ? `${(lb / 2000).toFixed(2)} tons` : `${Math.round(lb).toLocaleString("en-US")} lb`;
  }
  return kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : `${Math.round(kg)} kg`;
}

export function money(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function moneyShort(v: number): string {
  if (v >= 100000) return `$${Math.round(v / 1000)}k`;
  if (v >= 10000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(v)}`;
}

export function range(lo: number, hi: number): string {
  return `${moneyShort(lo)} – ${moneyShort(hi)}`;
}
