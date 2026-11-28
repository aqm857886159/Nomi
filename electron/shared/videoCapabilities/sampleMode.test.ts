import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getArchetypeById } from "../modelArchetypes/builtInCatalog";
import { SAMPLE_FINAL_MODE_ID, deriveSampleArchetype, findArchetypeMode, sampleBillingRequest } from "./sampleMode";
import { SEEDANCE_2_5_APIMART_ARCHETYPE } from "./seedance25Apimart";
import { SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE } from "./seedance25ApimartSample";
import type { ModelArchetype } from "./types";

const INPUT = { id: "seedance-2.5-apimart-sample", label: "Seedance 2.5（样片模式）", identifierPatterns: ["doubao-seedance-2.5-sample"], billedAs: { modelKey: "doubao-seedance-2.5" } };
const resolutionOf = (archetype: ModelArchetype, modeId: string) => archetype.modes.find((m) => m.id === modeId)!.params.find((p) => p.key === "resolution");

describe("样片档案由父档案推出（父改子跟，不另抄一份）", () => {
  const parent = SEEDANCE_2_5_APIMART_ARCHETYPE;
  const sample = SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE;

  it("父档案声明样片规格：72 小时、样片 480p、成片 1080p", () => {
    expect(parent.sampleMode).toEqual({ ttlHours: 72, draftResolution: "480p", finalResolutions: ["1080p"] });
  });

  it("注册进内置档案，按 id 取得到；样片档案不带自己的样片规格，只带 sampleOf", () => {
    expect(getArchetypeById("seedance-2.5-apimart-sample")).toBe(sample);
    expect(sample.sampleMode).toBeUndefined();
    expect(sample.sampleOf).toMatchObject({ parentId: parent.id, spec: parent.sampleMode, billedAs: { modelKey: "doubao-seedance-2.5" } });
  });

  it("方式、参考槽、固定参数与父档案一致；每个方式的清晰度只剩 480p，其余参数逐字相同", () => {
    expect(sample.modes.map((m) => m.id)).toEqual(parent.modes.map((m) => m.id));
    for (const mode of parent.modes) {
      const own = sample.modes.find((m) => m.id === mode.id)!;
      expect(own.slots).toEqual(mode.slots);
      expect(own.fixedParams).toEqual(mode.fixedParams);
      expect(own.params.filter((p) => p.key !== "resolution")).toEqual(mode.params.filter((p) => p.key !== "resolution"));
      const resolution = resolutionOf(sample, mode.id)!;
      expect(resolution.options.map((o) => o.value)).toEqual(["480p"]);
      expect(resolution.defaultValue).toBe("480p");
    }
  });

  it("出高清方式不在 modes 里（方式菜单看不到），只收样片号和成片清晰度", () => {
    expect(sample.modes.some((m) => m.id === SAMPLE_FINAL_MODE_ID)).toBe(false);
    const final = sample.sampleOf!.final;
    expect(final.id).toBe(SAMPLE_FINAL_MODE_ID);
    expect(final.slots).toEqual([]);
    expect(final.promptRequired).toBe(false);
    expect(final.params.map((p) => p.key)).toEqual(["draft_task_id", "resolution"]);
    expect(final.params[1]!.options.map((o) => o.value)).toEqual(["1080p"]);
    expect(final.params[1]!.defaultValue).toBe("1080p");
  });

  it("父档案改了，样片档案跟着变（时长上限、新参数、成片清晰度列表）", () => {
    const grown: ModelArchetype = {
      ...parent,
      sampleMode: { ...parent.sampleMode!, finalResolutions: ["1080p", "4k"] },
      modes: parent.modes.map((mode) => ({
        ...mode,
        params: [
          ...mode.params.map((p) => (p.key === "duration" ? { ...p, max: 45 } : p)),
          { key: "camera_fixed", label: "固定镜头", type: "boolean" as const, options: [], defaultValue: false },
        ],
      })),
    };
    const derived = deriveSampleArchetype(grown, INPUT);
    expect(derived.modes.find((m) => m.id === "t2v")!.params.find((p) => p.key === "duration")?.max).toBe(45);
    expect(derived.modes.every((m) => m.params.some((p) => p.key === "camera_fixed"))).toBe(true);
    expect(derived.sampleOf!.final.params[1]!.options.map((o) => o.value)).toEqual(["1080p", "4k"]);
    // 现网这一份就是同一个函数从现网父档案推出来的结果。
    expect(deriveSampleArchetype(parent, INPUT)).toEqual(sample);
  });

  it("样片档案文件里不许手写方式或参数（只准调用推导函数）", () => {
    const source = readFileSync(new URL("./seedance25ApimartSample.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bmodes\s*:|\bparams\s*:|\boptions\s*:/);
    expect(source).toMatch(/deriveSampleArchetype\(SEEDANCE_2_5_APIMART_ARCHETYPE/);
  });

  it("父档案没有样片规格、或清晰度里没有样片档 → 当场报错，不静默出一份残缺档案", () => {
    const { sampleMode: _drop, ...bare } = parent;
    expect(() => deriveSampleArchetype(bare as ModelArchetype, INPUT)).toThrow(/sampleMode/);
    const no480 = { ...parent, sampleMode: { ...parent.sampleMode!, draftResolution: "360p" } };
    expect(() => deriveSampleArchetype(no480, INPUT)).toThrow(/360p/);
  });
});

describe("findArchetypeMode", () => {
  it("modes 里有的照旧；样片档案多认出高清方式；别的档案不认", () => {
    expect(findArchetypeMode(SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE, "t2v")?.id).toBe("t2v");
    expect(findArchetypeMode(SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE, SAMPLE_FINAL_MODE_ID)?.id).toBe(SAMPLE_FINAL_MODE_ID);
    expect(findArchetypeMode(SEEDANCE_2_5_APIMART_ARCHETYPE, SAMPLE_FINAL_MODE_ID)).toBeUndefined();
    expect(findArchetypeMode(SEEDANCE_2_5_APIMART_ARCHETYPE, "")).toBeUndefined();
  });
});

describe("sampleBillingRequest：样片和出高清都按父行约价", () => {
  const sample = SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE;
  const draftRequest = {
    kind: "text_to_video",
    prompt: "海边清晨，回头望灯塔",
    extras: { modelKey: "doubao-seedance-2.5-sample", modelAlias: "doubao-seedance-2.5-sample", archetype: { id: sample.id, modeId: "t2v" }, resolution: "480p", duration: 12, generate_audio: false },
  };

  it("发样片：型号和档案换成父行，清晰度仍是 480p，其余计价项不动", () => {
    const billed = sampleBillingRequest(draftRequest, sample)!;
    expect(billed.extras).toEqual({ ...draftRequest.extras, modelKey: "doubao-seedance-2.5", modelAlias: "doubao-seedance-2.5", archetype: { id: "seedance-2.5-apimart", modeId: "t2v" } });
    expect(billed.prompt).toBe(draftRequest.prompt);
  });

  it("出高清：取样片当时冻结的请求，清晰度换成成片档；样片号不进约价请求", () => {
    const frozen = { ...draftRequest, extras: { ...draftRequest.extras, draft_task_id: "should-not-price" } };
    const billed = sampleBillingRequest(frozen, sample, "1080p")!;
    expect(billed.extras).toMatchObject({ modelKey: "doubao-seedance-2.5", resolution: "1080p", duration: 12, generate_audio: false, archetype: { id: "seedance-2.5-apimart" } });
    expect(billed.extras).not.toHaveProperty("draft_task_id");
  });

  it("不是样片档案、或请求记的不是这个档案、或成片清晰度不在规格里 → null（调用方照常约价）", () => {
    expect(sampleBillingRequest(draftRequest, SEEDANCE_2_5_APIMART_ARCHETYPE)).toBeNull();
    expect(sampleBillingRequest({ ...draftRequest, extras: { ...draftRequest.extras, archetype: { id: "seedance-2.5-apimart" } } }, sample)).toBeNull();
    expect(sampleBillingRequest(draftRequest, sample, "4k")).toBeNull();
    expect(sampleBillingRequest({ kind: "text_to_video" }, sample)).toBeNull();
  });
});
