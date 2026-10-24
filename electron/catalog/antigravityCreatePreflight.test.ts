import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), matches: vi.fn() }));
vi.mock("../ai/antigravityTask", () => ({
  prepareAntigravityTask: (...args: unknown[]) => mocks.prepare(...args),
  assertPreparedAntigravityTaskMatches: (...args: unknown[]) => mocks.matches(...args),
}));

import { prepareAntigravityCreateOperation } from "./antigravityCreatePreflight";
import { antigravityImageCreateOperation } from "./antigravityCatalog";
import { templateContext } from "./profileHttpRequest";
import { ANTIGRAVITY_IMAGE_MODEL_KEY, ANTIGRAVITY_VENDOR_KEY } from "../shared/antigravity";
import type { Model } from "./types";
import type { TaskRequest } from "../runtime";

// 带空格的参考链接：付费前的预检封存「要交给本机 CLI 的参考图」，发起时再按同一份核对（consumePreparedAntigravityTask 读
// context.request.params.reference_images）。两边都取 taskTemplateParams 序列化后的写法，带空格的参考核得上。
describe("prepareAntigravityCreateOperation × 带空格的参考链接", () => {
  it("预检封存的、预检核对的、发起时读到的参考图是同一份序列化后的写法", async () => {
    mocks.prepare.mockImplementation(async (input: unknown) => ({ prepared: input }));
    const operation = antigravityImageCreateOperation("image_edit");
    const request = { kind: "image_edit", prompt: "把背景换成海边", extras: { referenceImages: ["https://cdn.example.com/Windows ref.png"] } };
    await prepareAntigravityCreateOperation({
      vendorKey: ANTIGRAVITY_VENDOR_KEY,
      modelKey: ANTIGRAVITY_IMAGE_MODEL_KEY,
      taskKind: "image_edit",
      operation,
      request,
    });
    const serialized = ["https://cdn.example.com/Windows%20ref.png"];
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ imageUrls: serialized }));
    expect(mocks.matches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ imageUrls: serialized }));
    const model = { vendorKey: ANTIGRAVITY_VENDOR_KEY, modelKey: ANTIGRAVITY_IMAGE_MODEL_KEY, labelZh: "Antigravity", kind: "image", enabled: true } as Model;
    const context = templateContext(request as TaskRequest, model, "", {}, operation) as { request: { params: Record<string, unknown> } };
    expect(context.request.params.reference_images).toEqual(serialized);
  });
});
