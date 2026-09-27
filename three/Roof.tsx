"use client";

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ROOF_ISSUES, ROOF_MATERIAL_BY_ID } from "@/lib/options";
import { MAIN, MAIN_RIDGE_Y, MAIN_RIDGE_Z, ROOF_PLANE_BY_ID, ROOF_PLANES, WING, WING_RIDGE_X, WING_RIDGE_Y, type RoofPlane, type RoofSectionId } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { box, merge, planeMatrix, roofBody, roofSurface, type Placed } from "./geom";
import { metalPan, roofTile, shingles, slate } from "./proc";
import { channels, depthFor, fades, lazyCache, patch, wipes } from "./shared";

export const ROOF_T = 0.2;
const MAIN_IDS: RoofSectionId[] = ["main-front", "main-rear"];
const WING_IDS: RoofSectionId[] = ["wing-garden", "wing-side"];

function ribs(planes: RoofPlane[]): Placed[] {
  const out: Placed[] = [];
  const spacing = 0.46;
  for (const p of planes) {
    const n = Math.floor(p.width / spacing);
    const start = (p.width - (n - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) {
      out.push({ geo: box(0.022, 0.045, p.length), matrix: planeMatrix(p, start + i * spacing, p.length / 2, ROOF_T + 0.022) });
    }
  }
  return out;
}

function gutters(planes: RoofPlane[]): Placed[] {
  const out: Placed[] = [];
  for (const p of planes) {
    const g = new THREE.CylinderGeometry(0.075, 0.075, p.width, 10, 1);
    const U3 = new THREE.Vector3(...p.u);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), U3);
    const pos = new THREE.Vector3(...p.origin)
      .addScaledVector(U3, p.width / 2)
      .addScaledVector(new THREE.Vector3(...p.v), -0.06)
      .add(new THREE.Vector3(0, 0.02, 0));
    out.push({ geo: g, matrix: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)) });
    // downspouts tucked against the wall corners
    const top = pos.y;
    const V3 = new THREE.Vector3(...p.v);
    const inV = p.overhangV - 0.1; // just outside the wall line
    const ends = p.id.startsWith("main") ? [MAIN.rakeOverhang + 0.18, p.width - MAIN.rakeOverhang - 0.18] : p.id === "wing-garden" ? [WING.rakeOverhang + 0.18] : [p.width - WING.rakeOverhang - 0.18];
    for (const end of ends) {
      const at = new THREE.Vector3(...p.origin).addScaledVector(U3, end).addScaledVector(V3, inV);
      out.push({ geo: box(0.08, top, 0.08), pos: [at.x, top / 2, at.z] });
      out.push({ geo: box(0.08, 0.08, inV + 0.12), matrix: new THREE.Matrix4().makeBasis(U3, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(U3, new THREE.Vector3(0, 1, 0))).setPosition(new THREE.Vector3(...p.origin).addScaledVector(U3, end).addScaledVector(V3, inV / 2 - 0.03).setY(top - 0.04)) });
    }
  }
  return out;
}

function ridgeCaps(): { main: Placed[]; wing: Placed[] } {
  const mainLen = MAIN.x1 - MAIN.x0 + MAIN.rakeOverhang * 2;
  const wingLen = WING.z1 - WING.z0 + WING.rakeOverhang;
  return {
    main: [{ geo: box(mainLen, 0.1, 0.3), pos: [(MAIN.x0 + MAIN.x1) / 2, MAIN_RIDGE_Y + ROOF_T / Math.cos((MAIN.pitchDeg * Math.PI) / 180) + 0.02, MAIN_RIDGE_Z] }],
    wing: [{ geo: box(0.3, 0.1, wingLen), pos: [WING_RIDGE_X, WING_RIDGE_Y + ROOF_T / Math.cos((WING.pitchDeg * Math.PI) / 180) + 0.02, (WING.z0 - WING.rakeOverhang + WING.z1) / 2] }],
  };
}

type Kind = "shingle" | "metal" | "tile" | "slate";

function makeSurfaceMaterial(kind: Kind, fade?: { value: number }) {
  const base = { cut: "solid" as const, wipe: { side: "after" as const, u: wipes.roof }, fade };
  switch (kind) {
    case "shingle": {
      const t = shingles(false);
      return patch(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.9, color: "#3c3d40" }), base);
    }
    case "metal": {
      const t = metalPan();
      return patch(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.42, metalness: 0.55, color: "#27282b" }), base);
    }
    case "tile": {
      const t = roofTile();
      return patch(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.78, color: "#a2553b" }), base);
    }
    case "slate": {
      const t = slate();
      return patch(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.62, color: "#33373d" }), base);
    }
  }
}

/** Tuned so the colour on the roof reads as the swatch the customer picked, even in low warm sun. */
function tuneForColor(m: THREE.MeshStandardMaterial, kind: Kind, colorId: string, hexColor: string) {
  m.color.set(hexColor);
  const dark = new THREE.Color(hexColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
  m.envMapIntensity = dark ? 0.55 : 0.9;
  if (kind === "metal") {
    const bright = colorId === "galvalume";
    m.metalness = bright ? 0.8 : dark ? 0.12 : 0.4;
    m.roughness = bright ? 0.34 : dark ? 0.82 : 0.5;
  } else {
    m.roughness = dark ? 0.95 : 0.85;
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
    const surf = Object.fromEntries(ROOF_PLANES.map((p) => [p.id, roofSurface(p, ROOF_T)])) as Record<RoofSectionId, THREE.BufferGeometry>;
    const overlay = Object.fromEntries(ROOF_PLANES.map((p) => [p.id, roofSurface(p, ROOF_T + 0.06)])) as Record<RoofSectionId, THREE.BufferGeometry>;
    const caps = ridgeCaps();
    return {
      surf,
      overlay,
      mainBody: merge(MAIN_IDS.map((id) => ({ geo: roofBody(ROOF_PLANE_BY_ID[id], ROOF_T) }))),
      wingBody: merge(WING_IDS.map((id) => ({ geo: roofBody(ROOF_PLANE_BY_ID[id], ROOF_T) }))),
      mainRibs: merge(ribs(MAIN_IDS.map((id) => ROOF_PLANE_BY_ID[id]))),
      wingRibs: merge(ribs(WING_IDS.map((id) => ROOF_PLANE_BY_ID[id]))),
      mainGutters: merge(gutters(MAIN_IDS.map((id) => ROOF_PLANE_BY_ID[id]))),
      wingGutters: merge(gutters(WING_IDS.map((id) => ROOF_PLANE_BY_ID[id]))),
      mainCap: merge(caps.main),
      wingCap: merge(caps.wing),
    };
  }, []);

  // One material per roof kind, built on first use (main + wing; the wing fades while lifted).
  // Colour changes never recompile.
  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const kind = (k: Kind, wing: boolean) => lazy.get(`${k}${wing}`, () => makeSurfaceMaterial(k, wing ? fades.wingRoof : undefined)) as THREE.MeshStandardMaterial;
    const worn = (wing: boolean) =>
      lazy.get(`worn${wing}`, () => {
        const t = shingles(true);
        return patch(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95 }), { cut: "solid", wipe: { side: "before", u: wipes.roof }, fade: wing ? fades.wingRoof : undefined });
      }) as THREE.MeshStandardMaterial;
    const trim = patch(new THREE.MeshStandardMaterial({ color: "#232427", roughness: 0.5, metalness: 0.3 }), { cut: "solid" });
    const trimWing = patch(new THREE.MeshStandardMaterial({ color: "#232427", roughness: 0.5, metalness: 0.3 }), { cut: "solid", fade: fades.wingRoof });
    const cap = patch(new THREE.MeshStandardMaterial({ color: "#2c2d30", roughness: 0.6 }), { cut: "solid", wipe: { side: "after", u: wipes.roof } });
    const capWing = patch(new THREE.MeshStandardMaterial({ color: "#2c2d30", roughness: 0.6 }), { cut: "solid", wipe: { side: "after", u: wipes.roof }, fade: fades.wingRoof });
    const overlay = Object.fromEntries(
      ROOF_PLANES.map((p) => [p.id, new THREE.MeshBasicMaterial({ color: "#e3892a", transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })]),
    ) as Record<RoofSectionId, THREE.MeshBasicMaterial>;
    return { kind, worn, trim, trimWing, cap, capWing, overlay };
  }, [lazy]);
  useEffect(
    () => () => {
      lazy.dispose();
      [mats.trim, mats.trimWing, mats.cap, mats.capWing, ...Object.values(mats.overlay)].forEach((m) => m.dispose());
    },
    [lazy, mats],
  );

  useEffect(() => {
    const m = ROOF_MATERIAL_BY_ID[material];
    const c = m.colors.find((x) => x.id === color) ?? m.colors[0];
    tuneForColor(mats.kind(material, false), material, c.id, c.hex);
    tuneForColor(mats.kind(material, true), material, c.id, c.hex);
    const capHex = new THREE.Color(c.hex).multiplyScalar(material === "metal" ? 1 : 0.85);
    mats.cap.color.copy(capHex);
    mats.capWing.color.copy(capHex);
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

  return (
    <group name="roof">
      {/* main roof */}
      {MAIN_IDS.map((id) => (
        <mesh key={id} geometry={geo.surf[id]} material={mats.kind(K, false)} castShadow receiveShadow customDepthMaterial={depthSolid} {...surfaceProps(id)} />
      ))}
      <mesh geometry={geo.mainBody} material={mats.trim} castShadow receiveShadow customDepthMaterial={depthSolid} />
      <mesh geometry={geo.mainCap} material={mats.cap} castShadow customDepthMaterial={depthSolid} />
      <mesh geometry={geo.mainGutters} material={mats.trim} castShadow customDepthMaterial={depthSolid} />
      {K === "metal" && <mesh geometry={geo.mainRibs} material={mats.kind("metal", false)} castShadow receiveShadow customDepthMaterial={depthSolid} />}
      {showBefore && MAIN_IDS.map((id) => <mesh key={`b${id}`} geometry={geo.surf[id]} material={mats.worn(false)} receiveShadow />)}

      {/* kitchen wing roof — lifts away for the remodeling cutaway */}
      <group ref={wingGroup}>
        {WING_IDS.map((id) => (
          <mesh key={id} geometry={geo.surf[id]} material={mats.kind(K, true)} castShadow receiveShadow customDepthMaterial={depthWing} {...surfaceProps(id)} />
        ))}
        <mesh geometry={geo.wingBody} material={mats.trimWing} castShadow receiveShadow customDepthMaterial={depthWing} />
        <mesh geometry={geo.wingCap} material={mats.capWing} castShadow customDepthMaterial={depthWing} />
        <mesh geometry={geo.wingGutters} material={mats.trimWing} castShadow customDepthMaterial={depthWing} />
        {K === "metal" && <mesh geometry={geo.wingRibs} material={mats.kind("metal", true)} castShadow receiveShadow customDepthMaterial={depthWing} />}
        {showBefore && WING_IDS.map((id) => <mesh key={`b${id}`} geometry={geo.surf[id]} material={mats.worn(true)} receiveShadow />)}
      </group>

      {/* inspection overlays */}
      {ROOF_PLANES.map((p) => (
        <mesh
          key={`o${p.id}`}
          ref={(m) => {
            overlayRef.current[p.id] = m;
          }}
          geometry={geo.overlay[p.id]}
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
