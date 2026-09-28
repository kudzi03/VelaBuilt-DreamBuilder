"use client";

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ROOF_ISSUES, ROOF_MATERIAL_BY_ID, type RoofMaterialId } from "@/lib/options";
import { ROOF_PLANE_BY_ID, ROOF_PLANES, type RoofPlane, type RoofSectionId } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { box, merge, type Placed } from "./geom";
import { pbr, tintFor, type TexId } from "./materials";
import { channels, depthFor, fades, lazyCache, patch, wipes } from "./shared";

/**
 * The two flat roofs. Each is a thin slab with a dark edge; on top, a low coping upstand all
 * round and, inside it, the roof system the customer picked: single-ply membrane, standing-seam
 * metal, a sedum green roof in a gravel margin, or gravel ballast. Drains sit in the field.
 * UVs are metres (u along x, v toward the garden).
 */

/** coping upstand: width and height above the roof surface */
const COPING_W = 0.22;
const COPING_H = 0.12;
/** green roofs keep a vegetation-free gravel margin inside the coping */
const MARGIN_W = 0.45;

type Kind = RoofMaterialId;
const TEX: Record<Kind, TexId> = { membrane: "membrane", metal: "seam", green: "meadow", ballast: "gravel" };

/** A rectangle on the roof surface, inset from the slab edge, lifted by `lift`. UVs in metres. */
function field(p: RoofPlane, inset: number, lift: number): THREE.BufferGeometry {
  const w = p.width - inset * 2;
  const l = p.length - inset * 2;
  const g = new THREE.PlaneGeometry(w, l);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * l);
  g.translate(p.origin[0] + p.width / 2, p.origin[1] + lift, p.origin[2] - p.length / 2);
  return g;
}

/** A frame (ring) of strips round the roof, `w` wide and `h` tall, from `inset` inwards. */
function ring(p: RoofPlane, inset: number, w: number, h: number, y: number): Placed[] {
  const cx = p.origin[0] + p.width / 2;
  const cz = p.origin[2] - p.length / 2;
  const W = p.width - inset * 2;
  const L = p.length - inset * 2;
  return [
    { geo: box(W, h, w), pos: [cx, y + h / 2, cz + L / 2 - w / 2] },
    { geo: box(W, h, w), pos: [cx, y + h / 2, cz - L / 2 + w / 2] },
    { geo: box(w, h, L - w * 2), pos: [cx - W / 2 + w / 2, y + h / 2, cz] },
    { geo: box(w, h, L - w * 2), pos: [cx + W / 2 - w / 2, y + h / 2, cz] },
  ];
}

/** Slab under the surface: the dark edge seen from the ground (its underside is the soffit, drawn by the house). */
function slab(p: RoofPlane): THREE.BufferGeometry {
  const g = box(p.width, p.thickness - 0.01, p.length);
  g.translate(p.origin[0] + p.width / 2, p.origin[1] - (p.thickness - 0.01) / 2 - 0.005, p.origin[2] - p.length / 2);
  return g;
}

/** Standing seams every 0.46 m, running toward the garden (the fall of the roof). */
function seams(p: RoofPlane): Placed[] {
  const inset = COPING_W;
  const w = p.width - inset * 2;
  const n = Math.floor(w / 0.46);
  const start = inset + (w - (n - 1) * 0.46) / 2;
  const out: Placed[] = [];
  for (let i = 0; i < n; i++) out.push({ geo: box(0.022, 0.04, p.length - inset * 2), pos: [p.origin[0] + start + i * 0.46, p.origin[1] + 0.02, p.origin[2] - p.length / 2] });
  return out;
}

/** Outlets in the field (two per roof), with their gratings. */
function drains(p: RoofPlane): Placed[] {
  const out: Placed[] = [];
  for (const f of [0.25, 0.75]) {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 20);
    out.push({ geo: g, pos: [p.origin[0] + p.width * f, p.origin[1] + 0.012, p.origin[2] - p.length + COPING_W + 0.5] });
  }
  return out;
}

function makeSurfaceMaterial(kind: Kind, fade?: { value: number }) {
  const base = { cut: "solid" as const, wipe: { side: "after" as const, u: wipes.roof }, fade };
  if (kind === "metal") return patch(pbr("seam", { metalMap: true, normalScale: 0.6 }), base);
  if (kind === "green") return patch(pbr("meadow", { roughness: 1, envMapIntensity: 0.5, scale: 0.6 }), base);
  if (kind === "ballast") return patch(pbr("gravel", { roughness: 1, envMapIntensity: 0.6, scale: 0.7 }), base);
  return patch(pbr("membrane", { normalScale: 0.8, envMapIntensity: 0.8 }), base);
}

/** Tuned so the colour on the roof reads as the swatch the customer picked, even in low warm sun. */
function tuneForColor(m: THREE.MeshStandardMaterial, kind: Kind, colorId: string, hexColor: string) {
  tintFor(TEX[kind], hexColor, m.color);
  const dark = new THREE.Color(hexColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
  m.envMapIntensity = dark ? 0.55 : 0.85;
  if (kind === "metal") {
    // the seam set carries roughness 0.5 and metal 1 in its maps: factors scale them
    const bright = colorId === "galvalume";
    m.metalness = bright ? 0.85 : dark ? 0.15 : 0.45;
    m.roughness = (bright ? 0.32 : dark ? 0.78 : 0.5) / 0.5;
  } else if (kind === "membrane") {
    // single-ply is satin; EPDM is flatter
    m.roughness = colorId === "charcoal" ? 1.5 : 1.0;
  } else {
    m.roughness = 1;
  }
}

export function Roof() {
  const material = useDemo((s) => s.roofing.material);
  const color = useDemo((s) => s.roofing.color);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const compare = useDemo((s) => s.compare);
  const inspect = useDemo((s) => s.roofing.inspect);
  const flags = useDemo((s) => s.roofing.flags);
  const pending = useDemo((s) => s.roofing.pending);
  const patchRoof = useDemo((s) => s.patch);
  const [hover, setHover] = useState<RoofSectionId | null>(null);

  const geo = useMemo(() => {
    const per = (p: RoofPlane) => ({
      slab: slab(p),
      coping: merge(ring(p, 0, COPING_W, COPING_H, p.origin[1] - 0.01)),
      field: field(p, COPING_W, 0.004),
      inner: field(p, COPING_W + MARGIN_W, 0.02),
      margin: merge(ring(p, COPING_W, MARGIN_W, 0.03, p.origin[1])),
      seams: merge(seams(p)),
      drains: merge(drains(p)),
      overlay: field(p, 0, 0.1),
    });
    return { main: per(ROOF_PLANE_BY_ID["main-roof"]), wing: per(ROOF_PLANE_BY_ID["wing-roof"]) };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => Object.values(g).forEach((x) => x.dispose())), [geo]);

  // One material per roof kind, built on first use (main + wing; the wing fades while lifted).
  // Colour changes never recompile.
  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const kind = (k: Kind, wing: boolean) => lazy.get(`${k}${wing}`, () => makeSurfaceMaterial(k, wing ? fades.wingRoof : undefined)) as THREE.MeshStandardMaterial;
    const worn = (wing: boolean) =>
      lazy.get(`worn${wing}`, () => patch(pbr("concrete", { color: "#8f8a82", normalScale: 1.2, envMapIntensity: 0.4 }), { cut: "solid", wipe: { side: "before", u: wipes.roof }, fade: wing ? fades.wingRoof : undefined })) as THREE.MeshStandardMaterial;
    const margin = (wing: boolean) => lazy.get(`margin${wing}`, () => patch(pbr("gravel", { color: "#b9b3a8", roughness: 1, scale: 0.6 }), { cut: "solid", wipe: { side: "after", u: wipes.roof }, fade: wing ? fades.wingRoof : undefined })) as THREE.MeshStandardMaterial;
    // the slab edge and the coping: dark bronze, as the window frames
    const edge = (wing: boolean) => patch(new THREE.MeshStandardMaterial({ color: "#26241f", roughness: 0.5, metalness: 0.55, envMapIntensity: 0.9 }), { cut: "solid", fade: wing ? fades.wingRoof : undefined });
    const drain = patch(new THREE.MeshStandardMaterial({ color: "#3a3a3a", roughness: 0.6, metalness: 0.6 }), { cut: "solid" });
    const overlay = Object.fromEntries(
      ROOF_PLANES.map((p) => [p.id, new THREE.MeshBasicMaterial({ color: "#e3892a", transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })]),
    ) as Record<RoofSectionId, THREE.MeshBasicMaterial>;
    return { kind, worn, margin, edge: edge(false), edgeWing: edge(true), drain, overlay };
  }, [lazy]);
  useEffect(
    () => () => {
      lazy.dispose();
      [mats.edge, mats.edgeWing, mats.drain, ...Object.values(mats.overlay)].forEach((m) => m.dispose());
    },
    [lazy, mats],
  );

  useEffect(() => {
    const m = ROOF_MATERIAL_BY_ID[material];
    const c = m.colors.find((x) => x.id === color) ?? m.colors[0];
    tuneForColor(mats.kind(material, false), material, c.id, c.hex);
    tuneForColor(mats.kind(material, true), material, c.id, c.hex);
  }, [material, color, mats]);

  const depthSolid = useMemo(() => depthFor({ cut: "solid" }), []);
  const depthWing = useMemo(() => depthFor({ cut: "solid", fade: fades.wingRoof, fadeKey: "wingRoof" }), []);

  const wingGroup = useRef<THREE.Group>(null);
  const overlayRef = useRef<Record<string, THREE.Mesh | null>>({});
  const roofingActive = industry === "roofing" && phase === "explore";
  const showBefore = roofingActive && compare;

  useFrame((_, dt) => {
    const lift = channels.wingLift;
    if (wingGroup.current) {
      wingGroup.current.position.y = lift * lift * 3.2;
      wingGroup.current.visible = fades.wingRoof.value > 0.01;
    }
    const target = roofingActive && inspect ? 1 : 0;
    const k = 1 - Math.exp(-dt * 8);
    for (const p of ROOF_PLANES) {
      const mesh = overlayRef.current[p.id];
      if (!mesh) continue;
      const isHover = hover === p.id || pending?.section === p.id;
      const mat = mats.overlay[p.id];
      mat.color.set(isHover ? "#f6dcb0" : "#e3892a");
      const want = target * (isHover ? 0.34 : 0.1 + 0.05 * Math.sin(performance.now() / 380));
      mat.opacity += (want - mat.opacity) * k;
      mesh.visible = mat.opacity > 0.005;
    }
  });

  const onTap = (e: ThreeEvent<MouseEvent>, id: RoofSectionId) => {
    if (!roofingActive || !inspect) return;
    if (e.delta > 8) return;
    e.stopPropagation();
    const n = ROOF_PLANE_BY_ID[id].normal;
    patchRoof("roofing", { pending: { section: id, point: [e.point.x, e.point.y, e.point.z], normal: n } });
  };

  const K = material;
  const surfaceProps = (id: RoofSectionId) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => onTap(e, id),
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (!roofingActive || !inspect) return;
      e.stopPropagation();
      setHover(id);
      document.body.style.cursor = "crosshair";
    },
    onPointerOut: () => {
      setHover((h) => (h === id ? null : h));
      document.body.style.cursor = "";
    },
  });

  const roof = (id: RoofSectionId, g: (typeof geo)["main"], wing: boolean) => {
    const depth = wing ? depthWing : depthSolid;
    const edge = wing ? mats.edgeWing : mats.edge;
    const green = K === "green";
    return (
      <>
        <mesh geometry={g.slab} material={edge} castShadow receiveShadow customDepthMaterial={depth} />
        <mesh geometry={g.coping} material={edge} castShadow receiveShadow customDepthMaterial={depth} />
        <mesh geometry={green ? g.inner : g.field} material={mats.kind(K, wing)} receiveShadow {...surfaceProps(id)} />
        {green && <mesh geometry={g.margin} material={mats.margin(wing)} receiveShadow {...surfaceProps(id)} />}
        {K === "metal" && <mesh geometry={g.seams} material={mats.kind("metal", wing)} castShadow receiveShadow customDepthMaterial={depth} />}
        {(K === "membrane" || K === "metal") && <mesh geometry={g.drains} material={mats.drain} />}
        {showBefore && <mesh geometry={g.field} material={mats.worn(wing)} receiveShadow />}
      </>
    );
  };

  return (
    <group name="roof">
      {roof("main-roof", geo.main, false)}
      {/* kitchen pavilion roof — lifts away for the remodeling cutaway */}
      <group ref={wingGroup}>{roof("wing-roof", geo.wing, true)}</group>

      {/* inspection overlays */}
      {ROOF_PLANES.map((p) => (
        <mesh
          key={`o${p.id}`}
          ref={(m) => {
            overlayRef.current[p.id] = m;
          }}
          geometry={p.id === "main-roof" ? geo.main.overlay : geo.wing.overlay}
          material={mats.overlay[p.id]}
          visible={false}
          renderOrder={4}
          raycast={() => null}
        />
      ))}

      {roofingActive &&
        flags.map((f, i) => <Pin key={f.id} index={i + 1} point={f.point} normal={f.normal} label={ROOF_ISSUES.find((x) => x.id === f.issue)?.label ?? ""} />)}
      {roofingActive && pending && <Pin index={flags.length + 1} point={pending.point} normal={pending.normal} label="What's wrong here?" pending />}
    </group>
  );
}

function Pin({ index, point, normal, label, pending }: { index: number; point: [number, number, number]; normal: [number, number, number]; label: string; pending?: boolean }) {
  const pos = useMemo(() => new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...normal), 0.05), [point, normal]);
  const tip = useMemo(() => pos.clone().addScaledVector(new THREE.Vector3(...normal), 0.9), [pos, normal]);
  const line = useMemo(() => new THREE.BufferGeometry().setFromPoints([pos, tip]), [pos, tip]);
  return (
    <group>
      <lineSegments geometry={line}>
        <lineBasicMaterial color={pending ? "#f3d9ae" : "#e3892a"} />
      </lineSegments>
      <mesh position={pos}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial color={pending ? "#f3d9ae" : "#e3892a"} />
      </mesh>
      <Html position={tip} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className={`pin ${pending ? "pin--pending" : ""}`}>
          <span className="pin__n">{index}</span>
          <span className="pin__t">{label}</span>
        </div>
      </Html>
    </group>
  );
}
