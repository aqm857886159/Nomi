import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDurabilityMode } from "../durability";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { CANVAS_TEST_PROJECT, setupCanvasShots } from "./canvasShotTestUtils";

// Real repository correctness at single, batch and settled-run scale; only the provider is fake.
// Disk-heavy checks remain opt-in: NOMI_PERF=1; NOMI_PERF_EPHEMERAL=1 omits fsync.
const enabled = process.env.NOMI_PERF === "1";

function queuedVendor(setup: ReturnType<typeof setupCanvasShots>): void {
  setup.vendor.answer = async (call) => ({
    id: `task-queued-${call}`, kind: "text_to_image", status: "queued", assets: [], raw: {},
  });
}

describe.skipIf(!enabled)("canvas shot repository work (NOMI_PERF=1)", () => {
  beforeEach(() => setDurabilityMode(process.env.NOMI_PERF_EPHEMERAL === "1" ? "ephemeral" : "durable"));
  afterEach(() => setDurabilityMode("ephemeral"));

  it("single-node submits reach the provider once each", async () => {
    const setup = setupCanvasShots();
    try {
      queuedVendor(setup);
      const total = 60;
      for (let index = 0; index < total; index += 1) {
        await setup.submit(`node-${index}`, `record-${index}`, `prompt ${index}`);
      }
      expect(setup.vendor.executes).toHaveLength(total);
    } finally {
      fs.rmSync(setup.root, { recursive: true, force: true });
    }
  }, 600_000);

  it("batch consent permits 10 submits at the canvas default concurrency", async () => {
    const setup = setupCanvasShots();
    try {
      queuedVendor(setup);
      const shots = Array.from({ length: 10 }, (_, index) => ({ nodeId: `node-${index}`, runRecordId: `batch-${index}` }));
      setup.consent(shots);
      const queue = [...shots];
      const worker = async () => {
        for (let shot = queue.shift(); shot; shot = queue.shift()) {
          await setup.submit(shot.nodeId, shot.runRecordId, `prompt ${shot.nodeId}`);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      expect(setup.vendor.executes).toHaveLength(10);
    } finally {
      fs.rmSync(setup.root, { recursive: true, force: true });
    }
  }, 600_000);

  it("opening a project that already holds 500 settled canvas Runs", async () => {
    const setup = setupCanvasShots();
    try {
      // Prepare the settled-run fixture without fsync; reads are independent of it.
      setDurabilityMode("ephemeral");
      for (let index = 0; index < 500; index += 1) await setup.submit(`node-${index}`, `done-${index}`, `prompt ${index}`);
      queuedVendor(setup);
      for (let index = 0; index < 3; index += 1) await setup.submit(`node-open-${index}`, `open-${index}`);
      setDurabilityMode("durable");
      expect(setup.repository.read(CANVAS_TEST_PROJECT, canvasRunIdFor("done-499"))?.status).toBe("completed");

      setup.runs.recoverOrphans(CANVAS_TEST_PROJECT);
      // Settled canvas runs stay out of the production task list.
      expect(setup.repository.listRuns(CANVAS_TEST_PROJECT)).toEqual([]);
      expect(setup.repository.read(CANVAS_TEST_PROJECT, canvasRunIdFor("done-499"))?.status).toBe("completed");
    } finally {
      fs.rmSync(setup.root, { recursive: true, force: true });
    }
  }, 600_000);
});
