import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "scripts/**", "public/**"] },
  {
    // three/ is imperative scene-graph code: materials, uniforms and render targets are
    // created once and mutated in effects/useFrame by design (standard React Three Fiber).
    // The React Compiler is not enabled, so its immutability model does not apply here.
    files: ["three/**/*.{ts,tsx}"],
    rules: { "react-hooks/immutability": "off", "react-hooks/preserve-manual-memoization": "off" },
  },
];

export default config;
