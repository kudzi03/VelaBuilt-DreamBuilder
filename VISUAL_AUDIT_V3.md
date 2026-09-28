# Visual audit V3 — what still reads as CGI

Sources: the owner's phone screenshots of the deployed demo (iPhone, hero and HVAC), desktop
and phone renders of every scenario from the QA tours, and close crops of both. The product
and interface are out of scope: they stay as they are. This audit is about the world.

Verdict in one line: **the interface is ahead of the world.** The three things that give the
scene away first, in order, are the trees, the ground, and the lack of light layering at dusk.

Legend: **KEEP** — good enough, protect it. **IMPROVE** — right approach, execution short.
**REPLACE** — wrong approach for the quality bar.

| Area | Verdict | What reads as CGI | Fix in this pass |
| --- | --- | --- | --- |
| Trees | **REPLACE** | Every tree is a camera-facing impostor from an 8×8 atlas: each view is 128 px (64 px on the phone variant). A hero-distance tree spans ~900 device px on a phone, a 7–14× blow-up. Result: dark blotches with holes, "camo" patches behind the HVAC x-ray, no depth. | Real 3D trees built from the Poly Haven scans: trunk and limbs decimated, every leaf turned into a textured card from the tree's own leaf texture, thinned and scaled to keep the crown's coverage. Tens of thousands of triangles instead of millions. Impostors only in the far ring, and as the distance LOD. A denser tree line behind the house. |
| Vegetation (shrubs, beds) | **REPLACE** | Low-res shrub impostors read as brown twigs. The house stands on bare lawn. | Poly Haven grass and fern scans as instanced geometry; planting beds along the house and terrace; ornamental grass drifts by the pool. |
| Ground / grass | **IMPROVE** | Flat green; one colour; hard straight edges against paving and walls. | Macro colour and roughness variation, mown stripes kept subtle, darker damp edges at paving, bed edging, blade clumps in the foreground. |
| House geometry | **IMPROVE** | Clean massing, thin roof edges, no gutters, perfect planes. | Fascia and box gutters with downpipes, deeper eaves read with soffit lights, sills and reveals kept. The gable form stays: roofing, solar and truss scenarios depend on it. |
| Roof | **KEEP / IMPROVE** | Standing seam reads well at drone height; the edge is a knife edge. | Fascia board, gutter, drip edge. |
| Windows / glass | **KEEP** | Frames, reveals, sky reflection work. | — |
| Wood (cedar) | **KEEP** | Scan-based, true scale. | Warmth from soffit light scallops. |
| Stone cladding | **REPLACE** | 2.4 × 1.2 m pale panels read as tiles or plasterboard. | A stacked-stone scan with real relief (normal + AO) so grazing light carves it, as in the references. |
| Interior | **IMPROVE** | Upstairs rooms are lit empty boxes. The kitchen is good. | Sheer curtains, furniture silhouettes, lamps with warm pools of light; the room reads as lived-in from the garden. |
| Lighting | **IMPROVE** | Sky and interiors are right; the exterior has two wall lights. Real dusk photography is layered light: soffit downlights scalloping the walls, uplit trees, path and step lights, a glowing pool. | Soffit downlights with cone-shaped wall scallops, tree uplights, step and bollard lights, pool light, all warm white against the cool sky. |
| Shadows / contact | **IMPROVE** | AO exists on desktop; objects still sit on the lawn without a darkened contact, beds absent. | Contact darkening under furniture and planting, bed soil, grass edges. |
| Pool / water | **REPLACE** | Light-blue tile plane in daylight; flat teal at dusk. | Water shader: animated normals, Fresnel between reflection and depth colour, depth tint (shallow turquoise → deep blue), caustics on the floor, underwater light at dusk. |
| Outdoor furniture | **KEEP** | Modelled teak and cushions read correctly. | Grounding. |
| Pergola | **KEEP** | — | Downlights. |
| Solar | **KEEP** | Framed modules, cell texture, clearcoat glass. | — |
| Steel | **KEEP** | Filleted sections, plates, bolts, callouts, section-plane burn. | — |
| HVAC | **KEEP** | X-ray concept is strong; the background trees wrecked it. | Fixed by the trees. |
| Environment / sky | **KEEP** | Photographed skies, blue-hour grade, matched fog. | — |
| Camera | **KEEP** | Level shift-lens shots, planned flights through the glass. | — |
| Post-processing | **KEEP** | AgX, restrained bloom, AO on desktop. | No new effects: realism has to come from assets and light. |

## What is out of reach in a browser, and the stance taken

- Offline-quality global illumination: not attempted. Warm interiors and practical lights do
  the work a photographer's strobes and long exposures would.
- KTX2 textures: no encoder is available in this build environment; textures stay WebP with
  per-tier sizes. GLBs use meshopt.
- Individually modelled leaves: every Poly Haven tree is 1–7 million triangles. The card trees
  keep the scanned branch structure and leaf imagery at a fraction of the cost.
