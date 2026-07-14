const stage = (id, command, args = [], options = {}) => ({
  id,
  command,
  args,
  required: options.required !== false,
  env: options.env,
});

export const STAGES = {
  matrix: stage("matrix", "node", ["scripts/test-capability-matrix.mjs"]),
  unit: stage("unit", "pnpm", ["run", "test"]),
  gates: stage("gates", "pnpm", ["run", "gates"]),
  build: stage("build", "pnpm", ["run", "build"]),
  e2e: stage("e2e", "pnpm", ["run", "test:e2e"]),
  "journeys-ci": stage("journeys-ci", "pnpm", ["run", "test:journeys"]),
  "journeys-all": stage("journeys-all", "pnpm", ["eval:journey"]),
  "real-generation": stage("real-generation", "node", ["tests/ux/camera-move-render-e2e.mjs"], {
    env: { APIMART_E2E: "1", NOMI_SPEND_OK: "1", NOMI_E2E: "1", NOMI_E2E_ALLOW_MULTI_INSTANCE: "1" },
  }),
};

export const PROFILES = {
  quick: ["matrix", "unit"],
  ci: ["matrix", "unit", "build", "e2e", "journeys-ci"],
  "full-local": ["matrix", "gates", "e2e", "journeys-ci"],
  "real-generation": ["real-generation"],
  release: ["matrix", "gates", "e2e", "journeys-all", "real-generation"],
};
