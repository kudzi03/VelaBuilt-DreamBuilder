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
| Post-processing | **KEEP** | AgX, restrained bloom, AO on desktop. | No new effects: realism has to come from assets and light. (Pass 4 moved to ACES; see below.) |

## What is out of reach in a browser, and the stance taken

- Offline-quality global illumination: not attempted. Warm interiors and practical lights do
  the work a photographer's strobes and long exposures would.
- KTX2 textures: no encoder is available in this build environment; textures stay WebP with
  per-tier sizes. GLBs use meshopt.
- Individually modelled leaves: every Poly Haven tree is 1–7 million triangles. The card trees
  keep the scanned branch structure and leaf imagery at a fraction of the cost.

## What this pass changed

| Area | Before | Now |
| --- | --- | --- |
| Trees | Impostors everywhere (128 px per view; 64 px on phones). | Real 3D trees near the camera: the scan's own trunk and limbs (meshopt-simplified) and one card per leaf fitted to the leaf's UVs. The fir scan models single needles, so it is re-carded with sprigs from its own atlas (needles binned to voxels, plane by PCA, branch pointing away from the trunk). A sparser 3D LOD for the middle distance, impostors beyond and for the woodland ring. Level of detail chosen per plant, nearest first, every frame. |
| Shrubs | Brown twig impostors. | Searsia shrubs as 3D card models, fuller than the open scan (clipped garden specimens). |
| Beds | House and terrace on bare lawn. | Mulched beds in a steel edge with instanced fern and grass clumps: ferns along the west gable, a low bed between pool and terrace, the garden's west edge, the back boundary. |
| Stone base | 2.4 × 1.2 m pale panels (read as tiles). | Coursed slate veneer from a laid-wall scan, the one tell-tale pale block patched out so the 2.5 m repeat does not show. |
| Dusk light | Two round wall-light blobs; flat interiors. | Up/down wall lights as narrow beams grazing the stone (V scallops); soffit downlights over the glass wall and terrace; tree uplights; pendants that glow with the kitchen lamps; sheer curtains upstairs. |
| Pool | Tile plane under a tinted sheet. | Noise ripples, depth absorption (red lost first), moving caustics by day, a turquoise glow after dark, planar reflection on desktop. |
| Phones | — | Own tree budget on every tier; the 3D trees swap in after the reveal (the arrival loads on impostors); fewer ground-cover clumps; the lowest tier never draws full-detail trees or ground cover. Lamp uniforms packed to fit WebGL2's guaranteed fragment budget. |

Checked by rendering the arrival shot (desktop 1440 × 900, phone 390 × 844) after each
change and by close-ups with the interface hidden; the shots that exposed problems (fir cards
as planks, a bench that was really a gravel strip and two bollards, reeds across the phone
hero) led directly to the fixes above.

## Pass 3b — the glass house

The owner compared the phone hero with a reference photograph (a modern two-storey glass house
at blue hour, lit from inside, reflected in a pool) and asked for that, not a better barn. The
architecture was rebuilt; the product around it was kept.

| What the reference has | What the barn had | Now |
| --- | --- | --- |
| Glass floor to ceiling on both floors | Punched windows in cedar and slate | Sliding glass walls on the garden and west fronts of both floors; limestone only at the corners and end walls |
| Thin flat roof slabs, deep overhangs, lit soffits | A pitched metal roof | A 0.6 m roof slab reaching 2 m past the glass, a cantilevered balcony slab with a frameless glass rail, a lit canopy on the kitchen pavilion; downlights in every soffit |
| The rooms as the light source | Dim rooms behind small windows | Furnished living, dining and suite behind the glass, twelve warm lamps, recessed ceiling lights visible through the glazing |
| Calm water reflecting the house | Choppy cyan water | Calmer surface, stronger mirror, deeper teal body, warm underwater lights in the far walls |
| A clean foreground and an open sky | Reeds and a wall of firs | The pool-side bed removed, the east fir edge and the woodland behind the house thinned |

Knock-on changes, so every scenario still works on the new house: flat-roof systems for the
roofer (single-ply membrane, standing seam, sedum green roof, gravel ballast), solar rows on
tilted racks, a steel frame with parallel-chord roof trusses and balcony cantilevers, the air
handler and ducts in the roof void, a flat slatted oak ceiling in the kitchen.

## Pass 4 — the owner's five references

The owner's standard is five images: two dusk glass houses with pools, a steel-and-glass
building, and two night kitchens (graphite handleless joinery, a bold-veined waterfall island,
lit open shelving, LED at the plinth). Every scenario was rendered settled (the capture hook
`window.__settle` in `?debug` mode skips transitions) and compared with them.

### Bugs found first

| Where | What | Cause | Fix |
| --- | --- | --- | --- |
| Garden (daytime) | The whole frame rendered black | The pool caustic pattern was lifted from a shader that expects coordinates near −250; fed world coordinates near −19 its accumulator ran to ~10⁹ and overflowed the half-float render targets. NaN through bloom blanks the frame. | Tile the world position into the pattern's own domain; clamp the result |
| Steel | Milky white haze and a white blob over the frame | The same overflow as Inf: the pool is visible through the ghosted house, bloom spread it | Same fix |

### Closing the gap

| Reference shows | We had | Now |
| --- | --- | --- |
| A thin, dark roof edge; the overhang reads as a plate | A 0.72 m bronze-brown slab edge (0.6 m slab + coping) | Knife-edge overhang: a 0.3 m charcoal plate at the edge, the structural depth kept over the walls (its faces fold the cedar soffit up to the glass heads); a 50 mm coping |
| Warm soffits with a linear LED at the edge | Flat plaster soffits lit by the sky only | Cedar soffits; an LED cove inside the fascia on the garden and west edges, with the wash it throws across the soffit |
| Deep blue sky, warm band on the horizon, saturated amber interiors | Lavender sky, beige interiors under AgX | ACES filmic curve; the blue-hour grade pulls the zenith to deep blue and keeps a warm band at the horizon |
| Black frames | Dark bronze (read brown at dusk) | Charcoal aluminium frames, rail shoes and canopy |
| Pale fabrics on dark or silvered frames | Orange teak, terracotta cushions | Silvered teak, pale cushions, charcoal accents |
| Graphite handleless kitchen, marble waterfall island with bold veins | Sage shaker, fine-crackle marble, cabinets stopping short of the ceiling | Default: graphite handleless (new: two-tone grey and black); a generated Calacatta with bold umber veins and a gold halo (tileable, 3.2 × 1.6 m slab); tall units to the ceiling |
| Lit open shelving, LED at the plinth, downlights scalloping the splash | A lit stone ledge | A walnut-lined open niche with LED under each shelf; plinth LEDs under every run and the island (the pool of light on the floor drawn as an additive gradient); four recessed downlights washing the stone. The LED package is a priced option the customer can switch off. |
| Dark steel frame behind glass | Galvanised grey default | Painted charcoal is the default coating |
| Warm walls inside the pavilion | Mauve plaster (not lit by the kitchen lamps) | The pavilion's plaster takes the kitchen lamps; warmer plaster throughout |

Lamps: 46 of the 48 the fragment-uniform budget allows (kitchen downlights added). The LED
light itself costs no lamps: strips are emissive, their light is a gradient.
