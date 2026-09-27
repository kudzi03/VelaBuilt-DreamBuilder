import type { IndustryId } from "@/lib/industries";

type P = { size?: number; className?: string; title?: string };

const svg = (size: number, className?: string, title?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  role: title ? "img" : undefined,
  "aria-hidden": title ? undefined : true,
  "aria-label": title,
});

/** VelaBuilt monogram (from velabuilt.com/icon.svg). */
export function Mark({ size = 28, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <rect width="100" height="100" rx="18" fill="#050506" />
      <g fill="#e0c398">
        <path d="M21.2 28.2 L29.0 31.8 L50.8 90.2 L46.2 96.8 Z" />
        <path d="M45.0 24.6 C63.0 22.2 74.6 30.2 72.6 42.2 C70.8 51.6 62.6 57.0 53.6 57.8 C61.0 51.8 66.2 44.6 64.8 37.4 C63.4 30.6 55.4 25.8 45.0 24.6 Z" />
        <path d="M51.0 59.4 C70.4 57.2 82.4 66.4 79.8 79.4 C77.4 91.0 66.0 96.6 54.4 95.6 C64.8 90.0 71.4 81.4 69.8 72.6 C68.2 64.6 61.4 60.4 51.0 59.4 Z" />
      </g>
    </svg>
  );
}

export function IndustryIcon({ id, size = 24, className }: P & { id: IndustryId }) {
  const s = svg(size, className);
  switch (id) {
    case "remodeling":
      return (
        <svg {...s}>
          <path d="M3 13h18M4 13v7h16v-7" />
          <path d="M8 13v7M16 13v7M11 16.5h2" />
          <path d="M12 3v4M9.5 9.5a2.5 2.5 0 0 1 5 0z" />
        </svg>
      );
    case "roofing":
      return (
        <svg {...s}>
          <path d="M2.5 12 12 4l9.5 8" />
          <path d="M5 10v10h14V10" />
          <path d="M7.5 8.3h9M5.8 10.8h12.4" />
        </svg>
      );
    case "steel":
      return (
        <svg {...s}>
          <path d="M3 18 12 5l9 13z" />
          <path d="M3 18h18M7.5 11.5 9 18M16.5 11.5 15 18M12 5v13M9 18l3-6 3 6" />
        </svg>
      );
    case "solar":
      return (
        <svg {...s}>
          <path d="M4 19 7 9h13l-3 10z" />
          <path d="M5.5 14h13M11.3 9l-1.6 10M15.7 9l-1.6 10" />
          <path d="M5 3.5v1.5M2 6.5h1.5M3 4.5l1 1" />
        </svg>
      );
    case "landscaping":
      return (
        <svg {...s}>
          <path d="M2.5 20h19" />
          <path d="M7 20v-5M7 15c-2.5 0-4-1.8-4-4s1.8-4.5 4-4.5 4 2.3 4 4.5-1.5 4-4 4z" />
          <path d="M13 20v-8h8v8M13 12l4-2 4 2M17 12v8" />
        </svg>
      );
    case "hvac":
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 12c0-3 1.5-5 3.5-5M12 12c2.6 1.5 3.5 3.8 2.5 5.6M12 12c-2.6 1.5-5 1.2-6-.6" />
          <circle cx="12" cy="12" r="1.2" />
        </svg>
      );
  }
}

export const Arrow = ({ size = 18, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Back = ({ size = 18, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const Close = ({ size = 18, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const Check = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)} strokeWidth={2}>
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);
export const Replay = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5" />
  </svg>
);
export const Target = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
);
export const Paperclip = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </svg>
);
export const WhatsApp = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
    <path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.8l5.1-1.3A9.7 9.7 0 1 0 12 2.2Zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.4 1 2.5.1.2 1.7 2.6 4.2 3.7 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.4Z" />
  </svg>
);
export const Mail = ({ size = 18, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);
export const Share = ({ size = 18, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M12 3v12M7 8l5-5 5 5M5 13v6h14v-6" />
  </svg>
);
export const Calendar = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
export const Spark = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);
export const Orbit = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M4.5 9.5C3 10.4 2 11.4 2 12.5 2 15.5 6.5 18 12 18s10-2.5 10-5.5c0-1.1-1-2.1-2.5-3" />
    <path d="m9.5 15.5-2.5 2.5 2.5 2.5" />
    <circle cx="12" cy="8" r="3" />
  </svg>
);
export const Drag = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />
  </svg>
);
