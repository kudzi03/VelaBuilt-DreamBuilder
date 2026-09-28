/** Public configuration. Everything here is safe to ship to the browser. */

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();
export const VELABUILT_URL = "https://velabuilt.com";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "jace@velabuilt.com";
/** Digits only, international format. Empty → WhatsApp contact is hidden, never faked. */
export const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "").replace(/\D/g, "");
/** Cloudflare Turnstile site key (public by design). Empty → no human check on the form. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
export const INSTAGRAM_URL = "https://www.instagram.com/velabuilt";

export const SHARE_TITLE = "The Future of Contractor Sales";
export const SHARE_DESCRIPTION =
  "Interactive demo by VelaBuilt. Let customers explore, configure and price their project in 3D — then watch the enquiry become a qualified lead, a follow-up and a booked appointment.";
