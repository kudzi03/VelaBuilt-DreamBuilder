# Asset sources

Every third-party asset in this project, where it came from and its licence.
Nothing here requires attribution to ship, but credit is given anyway.

## Photo textures (CC0)

Downloaded from Poly Haven at 1K, converted to WebP (1024 px and 512 px variants) by
`public/textures/*.webp`. Used for surfaces a customer is choosing, where procedural
generation would look fake.

| Asset | Used for | Creator | Source | Licence |
| --- | --- | --- | --- | --- |
| Wood Floor | Kitchen floor · wide-plank oak | Dimitrios Savva | https://polyhaven.com/a/wood_floor | CC0 1.0 |
| Herringbone Parquet | Kitchen floor · herringbone oak | Jenelle van Heerden, Sergej Majboroda | https://polyhaven.com/a/herringbone_parquet | CC0 1.0 |
| Wood Floor Deck | Garden · hardwood deck | Dimitrios Savva | https://polyhaven.com/a/wood_floor_deck | CC0 1.0 |
| American Walnut Veneer | Cabinets · walnut flat panel | Jenelle van Heerden | https://polyhaven.com/a/american_walnut_veneer | CC0 1.0 |
| Oak Veneer 01 | Butcher-block tops, dining set, "before" honey-oak cabinets | Jenelle van Heerden | https://polyhaven.com/a/oak_veneer_01 | CC0 1.0 |
| Floor Tiles 06 | "Before" kitchen · dated checker floor | Rob Tuytel | https://polyhaven.com/a/floor_tiles_06 | CC0 1.0 |

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

## Fonts (SIL Open Font License 1.1)

Loaded with `next/font/google` and self-hosted at build time — the same families
velabuilt.com uses.

| Font | Designer | Source | Licence |
| --- | --- | --- | --- |
| Archivo | Omnibus-Type | https://fonts.google.com/specimen/Archivo | OFL 1.1 |
| Geist Mono | Vercel | https://fonts.google.com/specimen/Geist+Mono | OFL 1.1 |

## Brand

| Asset | Source | Notes |
| --- | --- | --- |
| VelaBuilt monogram (`public/icon.svg`, app icons) | https://velabuilt.com/icon.svg | VelaBuilt's own mark. PNG icons are rasterised from it by `scripts/og/icons.mjs`. |
| Colour and type tokens | https://velabuilt.com (site CSS) | Reused so the demo reads as the same studio. |

## Generated in this project (no external source)

| Asset | How |
| --- | --- |
| All 3D geometry — house, roof, kitchen, garden, steel frame, ducts, trees | Procedural, from the single spec in `lib/spec.ts` and `lib/steel.ts` |
| Shingles (new and worn), standing-seam pans, concrete tile, slate, lawn, patchy yard, render/plaster, cedar cladding, concrete, Calacatta marble, black granite, porcelain, polished concrete, zellige, laminate, limestone, solar cells, water normals, pool mosaic | Seeded procedural textures generated on the device, `three/proc.ts` |
| Image-based lighting | Hand-built light studio rendered to a PMREM at runtime, `three/Atmosphere.tsx` |
| Share image `public/og.jpg` | Rendered from the live scene + typography by `scripts/og/render.mjs` |
| No-WebGL poster `public/poster.jpg` | Rendered from the live scene by `scripts/og/poster.mjs` |
| Icons in the UI | Hand-drawn inline SVG, `components/icons.tsx` |

## Software

Open-source libraries are listed in `package.json` (three.js, React Three Fiber, drei,
postprocessing, n8ao, camera-controls, motion, zustand, zod — all MIT/ISC licensed).
