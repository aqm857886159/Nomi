import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["electron/shared/modelArchetypes/**/*.test.ts", "electron/parity/modeParamsSendPorts.test.ts", "electron/parity/variantResolutionParity.test.ts"],
    environment: "node",
  },
});
