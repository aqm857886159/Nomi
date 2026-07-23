import { describe, expect, it } from "vitest";
import type { CatalogState } from "./types";
import { selectTaskMapping } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";

function emptyCatalog(): CatalogState {
  return { version: 7, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}

const NOW = "2026-07-23T00:00:00.000Z";

describe("Codex 本地生图 seed", () => {
  const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);

  it("vendor 默认关闭，且不要求 API key", () => {
    const vendor = state.vendors.find((v) => v.key === "codex-local");
    expect(vendor).toMatchObject({
      key: "codex-local",
      enabled: false,
      baseUrlHint: "local://codex",
      authType: "none",
    });
  });

  it("只播一个图片模型，并接 text_to_image/image_edit 的 process transport", () => {
    const model = state.models.find((m) => m.vendorKey === "codex-local" && m.modelKey === "codex-imagegen");
    expect(model).toMatchObject({ kind: "image", enabled: true, labelZh: "Codex 生图（登录额度）" });
    expect(model?.meta).toMatchObject({ archetypeId: "codex-imagegen" });

    const t2i = selectTaskMapping(state.mappings, "codex-local", "text_to_image", "codex-imagegen");
    expect(t2i).toBeTruthy();
    expect(t2i?.create.method).toBe("PROCESS");
    expect(t2i?.create.process).toMatchObject({ bin: "codex", parser: "codex-cli-image", args: [] });
    expect(t2i?.query?.process).toMatchObject({ bin: "codex", parser: "codex-cli-image", args: ["query_result", "--submit_id={{providerMeta.task_id}}"] });
    expect(t2i?.create.response_mapping).toMatchObject({ image_url: "video_url" });

    const edit = selectTaskMapping(state.mappings, "codex-local", "image_edit", "codex-imagegen");
    expect(edit).toBeTruthy();
    expect(edit?.create.process).toMatchObject({ bin: "codex", parser: "codex-cli-image", args: [] });
    expect(edit?.query?.process).toMatchObject({ bin: "codex", parser: "codex-cli-image", args: ["query_result", "--submit_id={{providerMeta.task_id}}"] });
  });
});
