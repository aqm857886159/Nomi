// v3 → v4 迁移：给用户自建中转的旧图像/视频 op 补 paramMap（铁律翻译层）。
import { describe, expect, it } from "vitest";
import { migrateRelayParamMaps } from "./catalogStore";
import { NEWAPI_IMAGE_PARAM_MAP } from "./newapiTransport";
import type { Mapping } from "./types";

const NOW = "2026-06-24T00:00:00.000Z";
const mk = (over: Partial<Mapping>): Mapping => ({
  id: "x", vendorKey: "code-newcli-com", taskKind: "text_to_image", name: "x", enabled: true,
  create: { method: "POST", path: "/v1/images/generations", body: { model: "{{model.modelKey}}", size: "{{request.params.size}}" } },
  createdAt: NOW, updatedAt: NOW, ...over,
});

describe("migrateRelayParamMaps（v3→v4）", () => {
  it("用户自建中转的 OpenAI 兼容图像 op（读 size、无 paramMap）→ 补上图像 paramMap", () => {
    const { mappings, changed } = migrateRelayParamMaps([mk({})]);
    expect(changed).toBe(true);
    expect(mappings[0].create.paramMap).toEqual(NEWAPI_IMAGE_PARAM_MAP);
  });

  it("内置 vendor（apimart）不碰——它的 size 是比例字符串，套像素转换会发错", () => {
    const { mappings, changed } = migrateRelayParamMaps([mk({ vendorKey: "apimart" })]);
    expect(changed).toBe(false);
    expect(mappings[0].create.paramMap).toBeUndefined();
  });

  it("已有 paramMap → 幂等不重复补", () => {
    const { changed } = migrateRelayParamMaps([mk({ create: { method: "POST", path: "/v1/images/generations", body: { size: "{{request.params.size}}" }, paramMap: NEWAPI_IMAGE_PARAM_MAP } })]);
    expect(changed).toBe(false);
  });

  it("非 relay 形状（kie 的 /api/v1/jobs/createTask）→ 不碰", () => {
    const { changed } = migrateRelayParamMaps([mk({ vendorKey: "my-relay", create: { method: "POST", path: "/api/v1/jobs/createTask", body: { input: {} } } })]);
    expect(changed).toBe(false);
  });

  it("body 不读 size（不是像素契约）→ 不碰", () => {
    const { changed } = migrateRelayParamMaps([mk({ create: { method: "POST", path: "/v1/images/generations", body: { aspect_ratio: "{{request.params.aspect_ratio}}" } } })]);
    expect(changed).toBe(false);
  });
});
