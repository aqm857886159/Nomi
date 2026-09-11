import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetComfyObjectInfoCacheForTest,
  fetchComfyuiCheckpoints,
  fetchComfyuiObjectInfoIndex,
  parseObjectInfoIndex,
} from "./comfyuiObjectInfo";

const FULL = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["a.safetensors", "b.safetensors"]] } }, output: ["MODEL", "CLIP", "VAE"] },
  KSampler: {
    input: {
      required: {
        seed: ["INT", { default: 0 }], // 非枚举 spec：类型名字符串 → 不进 enums
        sampler_name: [["euler", "ddim"]],
      },
      optional: { extra: [["x"]] }, // optional 组同样收
    },
  },
  // 数字混进字符串数组：真机（下方 CreateVideo/ImageResizeKJ 夹具）证实这是真实、正在用的形态，
  // 不是「异形数据」——元素类型放宽到字符串|数字，数字转字符串收进来（见 classifyComboSpec 注释）。
  MixedTypeNode: { input: { required: { mixed: [[1, "a"]] } } },
  // 真正的「没见过的外壳」：名字里带 combo、既不是 "COMBO" 也不在已知白名单里 → 进 unknownComboShapes。
  FutureComboNode: { input: { required: { pick: ["SUPER_COMBO_V9", { options: ["a", "b"] }] } } },
  Broken: "not-a-record", // 异形 → class 记录但无枚举
};

describe("parseObjectInfoIndex（纯解析，全防御）", () => {
  it("收 class 集合 + combo 枚举（required/optional 都收；类型名不收，混杂数字数组现在也收）", () => {
    const index = parseObjectInfoIndex(FULL);
    expect(index.classNames.has("CheckpointLoaderSimple")).toBe(true);
    expect(index.classNames.has("KSampler")).toBe(true);
    expect(index.classNames.has("Broken")).toBe(false); // 值不是对象 → 不算已装类
    expect(index.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name")).toEqual(["a.safetensors", "b.safetensors"]);
    expect(index.enumsByClass.get("KSampler")?.get("sampler_name")).toEqual(["euler", "ddim"]);
    expect(index.enumsByClass.get("KSampler")?.get("seed")).toBeUndefined();
    expect(index.enumsByClass.get("KSampler")?.get("extra")).toEqual(["x"]);
    expect(index.enumsByClass.get("MixedTypeNode")?.get("mixed")).toEqual(["1", "a"]);
  });

  it("没见过的外壳（名字带 combo 但不认识）→ 不进 enums，进 unknownComboShapes 供反馈诊断用", () => {
    const index = parseObjectInfoIndex(FULL);
    expect(index.enumsByClass.get("FutureComboNode")).toBeUndefined();
    expect(index.unknownComboShapes).toEqual(
      expect.arrayContaining([
        { classType: "FutureComboNode", inputKey: "pick", spec: ["SUPER_COMBO_V9", { options: ["a", "b"] }] },
      ]),
    );
  });

  it("非对象输入 → 空索引（不抛）", () => {
    expect(parseObjectInfoIndex(null).classNames.size).toBe(0);
    expect(parseObjectInfoIndex("junk").classNames.size).toBe(0);
    expect(parseObjectInfoIndex(null).unknownComboShapes).toEqual([]);
  });
});

describe("fetch 层（stub 全局 fetch）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetComfyObjectInfoCacheForTest();
  });

  it("fetchComfyuiCheckpoints：/object_info/CheckpointLoaderSimple → 文件名列表", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ CheckpointLoaderSimple: FULL.CheckpointLoaderSimple })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchComfyuiCheckpoints("127.0.0.1:8188/")).toEqual(["a.safetensors", "b.safetensors"]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8188/object_info/CheckpointLoaderSimple", expect.any(Object));
  });

  it("连不上 → null（调用方按「不可核对」处理，不误报全缺）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchComfyuiCheckpoints("http://127.0.0.1:8188")).toBeNull();
    expect(await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188")).toBeNull();
  });

  it("响应形状不认识（空对象）→ null，不当成「没装任何节点」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    expect(await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188")).toBeNull();
  });

  it("60s 缓存：同 URL 第二次不再发请求", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FULL)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188");
    await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发缓存：同 URL 的未完成请求合并成一次 fetch", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify(FULL));
    });
    vi.stubGlobal("fetch", fetchMock);
    const requests = Array.from({ length: 20 }, () => fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release?.();
    const results = await Promise.all(requests);
    expect(results.every((item) => item?.classNames.has("KSampler"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("空 combo 列表 = 枚举（真服务器实测抓到的沉默失灵）", () => {
  // 真 ComfyUI 0.29.0 实测：models/checkpoints 为空时 ckpt_name 的 spec 就是 [[]]。
  // 早先把「空数组」当「不是枚举」跳过 → 一个模型都没装的用户，缺件对账整个沉默。
  const emptyDir = parseObjectInfoIndex({
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
    KSampler: { input: { required: { sampler_name: [["euler", "ddim"]], seed: ["INT", {}] } } },
  });

  it("空 combo 仍进枚举表（不是「这输入不是枚举」）", () => {
    expect(emptyDir.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name")).toEqual([]);
  });

  it("对账后果：本机没装任何模型 → 图里的 ckpt 如实报缺（而不是沉默）", async () => {
    const { reconcileComfyWorkflow } = await import("./catalog/comfyuiWorkflowImport");
    const graph = { "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd15.safetensors" } } };
    const r = reconcileComfyWorkflow(graph, emptyDir);
    expect(r.missingEnumValues).toEqual([
      { nodeId: "1", classType: "CheckpointLoaderSimple", title: undefined, inputKey: "ckpt_name", value: "sd15.safetensors" },
    ]);
  });

  it("烤入侧不受影响：空列表不烤成空下拉", async () => {
    const { collectGraphEnumOptions } = await import("./catalog/comfyuiWorkflowImport");
    const graph = { "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd15.safetensors" } } };
    expect(collectGraphEnumOptions(graph, emptyDir)).toEqual([]);
  });

  it("非枚举 spec（类型名字符串）仍不收", () => {
    expect(emptyDir.enumsByClass.get("KSampler")?.has("seed")).toBe(false);
  });
});

// 2026-09-11 真机夹具：本机起 comfyanonymous/ComfyUI（--cpu，0 自定义节点、0 已装模型），
// curl localhost:8188/object_info 拿到 928 个类的真实全量返回，其中 500 处 combo 字段是新格式
// ["COMBO", {...}]（老格式只剩函数式 INPUT_TYPES 的节点，如 KSampler）。下面四段逐字摘自那份
// 真实响应（未手改，只裁掉不相关的输入键），对应真机看到的三种典型形状：
//   · TripleCLIPLoader.clip_name1/2/3 —— 模型文件下拉，新格式，本机 0 个 CLIP 文件 → options: []；
//   · LatentConcat.dim —— 非文件枚举，新格式，静态非空 options；
//   · LoadImageOutput.image —— 纯 remote 动态下拉，没有 options 字段（本地没有可核对的列表）。
const REAL_TRIPLE_CLIP_LOADER = {
  input: {
    required: {
      clip_name1: ["COMBO", { multiselect: false, options: [] }],
      clip_name2: ["COMBO", { multiselect: false, options: [] }],
      clip_name3: ["COMBO", { multiselect: false, options: [] }],
    },
  },
};
const REAL_LATENT_CONCAT = {
  input: {
    required: {
      samples1: ["LATENT", {}],
      samples2: ["LATENT", {}],
      dim: ["COMBO", { multiselect: false, options: ["x", "-x", "y", "-y", "t", "-t"] }],
    },
  },
};
const REAL_LOAD_IMAGE_OUTPUT = {
  input: {
    required: {
      image: ["COMBO", { image_upload: true, image_folder: "output", remote: { route: "/internal/files/output", refresh_button: true, control_after_refresh: "first" } }],
    },
  },
};
// KSampler 老格式节点原样保留在同一份真机响应里，验证新旧两种格式在同一 /object_info 里共存不打架。
const REAL_KSAMPLER_OLD_FORMAT = {
  input: {
    required: {
      seed: ["INT", { default: 0 }],
      sampler_name: [["euler", "euler_ancestral", "ddim"], { tooltip: "The algorithm used when sampling." }],
    },
  },
};

describe("新一代节点 COMBO 格式（2026-09-11 真机 ComfyUI 0.35.0 /object_info 实测，R21 root-cause 2026-09-11-comfyui-combo-format-drift）", () => {
  const REAL_FULL = {
    TripleCLIPLoader: REAL_TRIPLE_CLIP_LOADER,
    LatentConcat: REAL_LATENT_CONCAT,
    LoadImageOutput: REAL_LOAD_IMAGE_OUTPUT,
    KSampler: REAL_KSAMPLER_OLD_FORMAT,
  };
  const index = parseObjectInfoIndex(REAL_FULL);

  it("新格式模型文件字段（真机 0 个文件）仍进枚举表，是空数组不是「未知」", () => {
    expect(index.enumsByClass.get("TripleCLIPLoader")?.get("clip_name1")).toEqual([]);
    expect(index.enumsByClass.get("TripleCLIPLoader")?.get("clip_name2")).toEqual([]);
    expect(index.enumsByClass.get("TripleCLIPLoader")?.get("clip_name3")).toEqual([]);
  });

  it("新格式非文件枚举（静态非空 options）正常收", () => {
    expect(index.enumsByClass.get("LatentConcat")?.get("dim")).toEqual(["x", "-x", "y", "-y", "t", "-t"]);
    expect(index.enumsByClass.get("LatentConcat")?.has("samples1")).toBe(false); // LATENT 不是 combo
  });

  it("纯 remote 动态下拉（无 options 字段）判「未知」，不是「已装 0 个」", () => {
    // LoadImageOutput 唯一的输入字段 image 就是这个 remote 下拉，识别不出任何枚举 →
    // 整个 class 都不会进 enumsByClass（class 本身仍在 classNames 里，只是没有可核对的枚举）。
    expect(index.classNames.has("LoadImageOutput")).toBe(true);
    expect(index.enumsByClass.has("LoadImageOutput")).toBe(false);
    expect(index.enumsByClass.get("LoadImageOutput")?.get("image")).toBeUndefined();
  });

  it("老格式节点在同一份响应里与新格式共存，不受影响", () => {
    expect(index.enumsByClass.get("KSampler")?.get("sampler_name")).toEqual(["euler", "euler_ancestral", "ddim"]);
  });

  it("先红后绿①（对账）：新格式模型文件字段引用了本机没有的文件名 → 如实报缺（改前：整段被当无枚举跳过，完全测不出，等 /prompt 执行才报错）", async () => {
    const { reconcileComfyWorkflow } = await import("./catalog/comfyuiWorkflowImport");
    const graph = { "1": { class_type: "TripleCLIPLoader", inputs: { clip_name1: "clip_l.safetensors", clip_name2: "clip_g.safetensors", clip_name3: "t5xxl.safetensors", type: "sd3" } } };
    const r = reconcileComfyWorkflow(graph, index);
    expect(r.missingEnumValues).toEqual(
      expect.arrayContaining([
        { nodeId: "1", classType: "TripleCLIPLoader", title: undefined, inputKey: "clip_name1", value: "clip_l.safetensors" },
        { nodeId: "1", classType: "TripleCLIPLoader", title: undefined, inputKey: "clip_name2", value: "clip_g.safetensors" },
        { nodeId: "1", classType: "TripleCLIPLoader", title: undefined, inputKey: "clip_name3", value: "t5xxl.safetensors" },
      ]),
    );
    expect(r.missingEnumValues).toHaveLength(3); // type 不是 combo 字段，不核
  });

  it("先红后绿②（烤下拉）：新格式非文件枚举能烤出真实下拉（改前：判无枚举，画布上是文本框）", async () => {
    const { collectGraphEnumOptions } = await import("./catalog/comfyuiWorkflowImport");
    const graph = { "1": { class_type: "LatentConcat", inputs: { dim: "x" } } };
    expect(collectGraphEnumOptions(graph, index)).toEqual([{ classType: "LatentConcat", inputKey: "dim", options: ["x", "-x", "y", "-y", "t", "-t"] }]);
  });

  it("remote 动态下拉不报缺、不烤下拉（本地没有列表可核对，维持文本框）", async () => {
    const { reconcileComfyWorkflow, collectGraphEnumOptions } = await import("./catalog/comfyuiWorkflowImport");
    const graph = { "1": { class_type: "LoadImageOutput", inputs: { image: "whatever-the-user-picked.png" } } };
    expect(reconcileComfyWorkflow(graph, index).missingEnumValues).toEqual([]);
    expect(collectGraphEnumOptions(graph, index)).toEqual([]);
  });
});

describe("MultiCombo 多选（手工构造，未在本机真机响应里遇到——本机没有装任何用 MultiCombo 的自定义节点）", () => {
  // 逐字对照 comfy_api/latest/_io.py（comfyanonymous/ComfyUI @ 2026-09-11 clone，commit 为 main HEAD）
  // 第 397-415 行 MultiCombo.Input.as_dict：在 Combo 的 multiselect/options 之上多一个 multi_select
  // 对象（{placeholder, chip}），顶层仍保留 multiselect:true 做向后兼容。
  const MULTI_COMBO_SPEC = {
    MultiComboDemoNode: {
      input: {
        required: {
          tags: [
            "COMBO",
            { multiselect: true, options: ["red", "green", "blue"], multi_select: { placeholder: "pick tags", chip: true } },
          ],
        },
      },
    },
  };

  it("先当普通枚举收（TODO：多选语义暂不做，见 electron/comfyuiObjectInfo.ts classifyComboSpec 注释）", () => {
    const index = parseObjectInfoIndex(MULTI_COMBO_SPEC);
    expect(index.enumsByClass.get("MultiComboDemoNode")?.get("tags")).toEqual(["red", "green", "blue"]);
  });
});

// 步骤 2 要求的可读夹具文件：electron/__fixtures__/comfyui-object-info-real-sample.json 逐字摘自
// 本机 ~/ComfyUI 0.35.0（真实自定义节点，非零起点）2026-09-11 curl localhost:8188/object_info 的
// 真实响应，只裁剪不相关输入键/压缩了 DynamicCombo 的嵌套选项数组长度，provenance 见文件内 `_provenance`。
describe("真机夹具文件（electron/__fixtures__/comfyui-object-info-real-sample.json）", () => {
  const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/comfyui-object-info-real-sample.json", import.meta.url), "utf8"));
  const index = parseObjectInfoIndex(fixture);

  it("新格式模型文件字段（真机 0 个 CLIP 文件）仍进枚举表，是空数组不是「未知」", () => {
    expect(index.enumsByClass.get("TripleCLIPLoader")?.get("clip_name1")).toEqual([]);
  });

  it("真机撞到的混合类型 COMBO options（CreateVideo.bit_depth: [\"auto\", 8, 10]）现在能收，数字转字符串", () => {
    expect(index.enumsByClass.get("CreateVideo")?.get("bit_depth")).toEqual(["auto", "8", "10"]);
  });

  it("真机撞到的混合类型老格式数组（ImageResizeKJ.crop: [\"disabled\",\"center\",0]，第三方 KJNodes）同样能收", () => {
    expect(index.enumsByClass.get("ImageResizeKJ")?.get("crop")).toEqual(["disabled", "center", "0"]);
  });

  it("DynamicCombo（COMFY_DYNAMICCOMBO_V3，嵌套子 schema，非扁平枚举）已知且故意排除，不进 unknownComboShapes", () => {
    expect(index.enumsByClass.get("ResizeImageMaskNode")).toBeUndefined();
    expect(index.unknownComboShapes.some((u) => u.classType === "ResizeImageMaskNode")).toBe(false);
  });

  it("这份真机夹具里没有真正没见过的外壳（两种已知形状 + 一个已知排除项覆盖了全部真实字段）", () => {
    expect(index.unknownComboShapes).toEqual([]);
  });
});

describe("classifyComboSpec 的没见过外壳判定（手工构造，覆盖真机夹具里未出现的畸形情况）", () => {
  it("COMBO 外壳但 config 不是对象 → 未知（_io.py 的 as_dict 恒产出一个 config 对象，缺失=没见过的变体）", () => {
    const index = parseObjectInfoIndex({ Weird: { input: { required: { x: ["COMBO", "not-an-object"] } } } });
    expect(index.unknownComboShapes).toEqual([{ classType: "Weird", inputKey: "x", spec: ["COMBO", "not-an-object"] }]);
  });

  it("COMBO.options 存在但不是数组 → 未知（不是「已装 0 个」也不是 remote-only）", () => {
    const index = parseObjectInfoIndex({ Weird: { input: { required: { x: ["COMBO", { options: "not-an-array" }] } } } });
    expect(index.unknownComboShapes).toEqual([{ classType: "Weird", inputKey: "x", spec: ["COMBO", { options: "not-an-array" }] }]);
  });

  it("options 数组里混进对象/布尔这类既非字符串也非数字的元素 → 未知", () => {
    const index = parseObjectInfoIndex({ Weird: { input: { required: { x: ["COMBO", { options: [true, "a"] }] } } } });
    expect(index.unknownComboShapes.map((u) => u.inputKey)).toEqual(["x"]);
  });

  it("spec[0] 既不是数组也不是字符串（彻底陌生的外壳）→ 未知", () => {
    const index = parseObjectInfoIndex({ Weird: { input: { required: { x: [{ nested: true }, {}] } } } });
    expect(index.unknownComboShapes).toEqual([{ classType: "Weird", inputKey: "x", spec: [{ nested: true }, {}] }]);
  });

  it("普通类型名（INT/STRING/IMAGE）不是 combo 语义，不进 unknownComboShapes", () => {
    const index = parseObjectInfoIndex({ Normal: { input: { required: { a: ["INT", {}], b: ["STRING", {}], c: ["IMAGE", {}] } } } });
    expect(index.unknownComboShapes).toEqual([]);
  });

  it("超过 50 条时截断，不让某台装了大量自定义节点的机器把诊断本身撑爆", () => {
    const json: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      json[`Node${i}`] = { input: { required: { pick: [`WEIRD_COMBO_${i}`, {}] } } };
    }
    const index = parseObjectInfoIndex(json);
    expect(index.unknownComboShapes).toHaveLength(50);
  });
});
