// ComfyUI 0.30「子图（subgraph）」工作流的提示词识别。
//
// 背景（用户 2026-08-03 反馈）：MiniMax H3 开源版要 ComfyUI ≥0.30，官方模板把整条管线打包进**子图**，
// 顶层只剩 SaveVideo / ResolutionSelector / 子图实例三个节点，提示词被**提升到子图边界**当入参。
// 展开成 API 格式后，prompt 落在 `MiniMaxH3ImageToVideo.prompt` 这个**连线**输入上——而它不是
// text-encode 类节点。早先追溯连线提示词的分支卡了 TEXT_ENCODE_RE，于是整条识别不出来：
// 用户看到「提示词第几个节点」是空的，而本该当提示词的那个节点跑进了「生成时可用参数」列表。
//
// 夹具节点名全部取自**官方模板真身**（Comfy-Org/workflow_templates 的 video_minimax_h3_t2v.json，
// 子图 "Image to Video (MiniMax H3)" 内含 MiniMaxH3ImageToVideo / BasicGuider / BasicScheduler /
// UNETLoader / CLIPLoader / CreateVideo …），不自己编——本轮栽过「编错 fixture 把自己骗过去」。
import { describe, expect, it } from "vitest";
import {
  analyzeComfyWorkflow, buildImportedWorkflow, inputKeyOf, roleBoundInputKeys, type ComfyGraph,
} from "./comfyuiWorkflowImport";

const PROMPT_TEXT =
  "Realistic live-action cinematic look, action movie trailer: practical film photography style, a post-rain dusk metropolis, anamorphic lens, shallow depth of field.";

/** 子图展开后的 API 图。variant 决定 prompt 是「连线进来」还是「直接摆在节点上」。 */
function h3Graph(variant: "linked" | "inline"): ComfyGraph {
  const graph: ComfyGraph = {
    "92": { class_type: "SaveVideo", inputs: { video: ["91", 0] } },
    "91": { class_type: "CreateVideo", inputs: { images: ["124", 0] } },
    "115": { class_type: "ResolutionSelector", inputs: { megapixels: 1, aspect: "16:9" } },
    "6": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va.safetensors" } },
    "13": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl.safetensors" } },
    "16": { class_type: "BasicGuider", inputs: { model: ["6", 0], conditioning: ["124", 0] } },
    "9": { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 20, denoise: 1 } },
    "124": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["13", 0],
        vae: ["11", 0],
        width: ["115", 0],
        height: ["115", 1],
        length: 121,
        prompt: variant === "linked" ? ["130", 0] : PROMPT_TEXT,
      },
    },
  };
  if (variant === "linked") {
    // 子图把 prompt 提升成入参 → 展开后由一个字符串节点喂进来。
    graph["130"] = { class_type: "PrimitiveStringMultiline", inputs: { value: PROMPT_TEXT } };
  }
  return graph;
}

describe("ComfyUI 0.30 子图工作流（MiniMax H3 官方模板形态）", () => {
  for (const variant of ["linked", "inline"] as const) {
        it(`prompt ${variant === "linked" ? "从连线进来" : "直接摆在节点上"} → 认得出提示词节点`, () => {
      const analysis = analyzeComfyWorkflow(h3Graph(variant));
      expect(analysis.suggested.promptNodeId).toBeTruthy();
      // 认出来的那个位置，值必须真是提示词文本（而不是随便挑了个字符串输入）。
      const picked = analysis.textInputs.find(
        (t) => t.nodeId === analysis.suggested.promptNodeId && t.inputKey === analysis.suggested.promptInputKey,
      );
      expect(String(picked?.value ?? "")).toContain("action movie trailer");
    });
  }

  it("成图输出节点认得出是 SaveVideo（用户截图里这条本来就对，别修坏）", () => {
    const analysis = analyzeComfyWorkflow(h3Graph("linked"));
    expect(analysis.suggested.outputNodeId).toBe("92");
    expect(analysis.suggested.outputKind).toBe("video");
    expect(buildImportedWorkflow(h3Graph("linked"), analysis.suggested).kind).toBe("video");
  });

  it("提示词不会出现在「生成时可用参数」候选里（用户看到的正是它跑到了那里）", () => {
    const analysis = analyzeComfyWorkflow(h3Graph("inline"));
    // 候选池 = 全量标量 widget 减掉当前绑定占用的（渲染层同款推导，见 src/ui/onboarding/comfyuiParamCandidates.ts）。
    const bound = roleBoundInputKeys(analysis.suggested);
    const offered = analysis.widgetInputs.filter((w) => !bound.has(inputKeyOf(w.nodeId, w.inputKey)));
    expect(offered.some((w) => String(w.value ?? "").includes("action movie trailer"))).toBe(false);
  });

  // ── 下面两条是 2026-08-11 复发时挖到的真根因（比「跑进参数列表」严重：它会静默吃掉提示词）──

  it("提示词输入被同时当成可调参数时，{{request.prompt}} 不许被参数占位覆盖", () => {
    const graph = h3Graph("inline");
    const analysis = analyzeComfyWorkflow(graph);
    const promptNodeId = String(analysis.suggested.promptNodeId);
    const promptInputKey = String(analysis.suggested.promptInputKey);
    // 模拟旧草稿/旧版本留下的形态：同一个输入既是提示词、又被列进 params。
    const built = buildImportedWorkflow(graph, {
      ...analysis.suggested,
      params: [{
        nodeId: promptNodeId, inputKey: promptInputKey,
        paramKey: "comfy_prompt", label: "提示词", type: "text", default: "占位默认值",
      }],
    });
    // 参数循环在角色之后跑，不拦就是「用户输入框里打的字根本没送进 ComfyUI」，且界面上看不出异常。
    expect(built.templatedGraph[promptNodeId]?.inputs?.[promptInputKey]).toBe("{{request.prompt}}");
    expect(built.parameters.some((p) => p.key === "comfy_prompt")).toBe(false);
  });

  it("角色占用是按当前绑定算的：改了提示词节点，参数候选跟着变（不钉死在自动建议上）", () => {
    const graph = h3Graph("linked"); // 130=PrimitiveStringMultiline.value 与 124.prompt 都可当提示词
    const analysis = analyzeComfyWorkflow(graph);
    const suggested = roleBoundInputKeys(analysis.suggested);
    expect(suggested.has(inputKeyOf("130", "value"))).toBe(true);
    // 用户改绑到别处 → 130 必须重新可选为参数，新选中的那个才被占用。
    const moved = roleBoundInputKeys({ ...analysis.suggested, promptNodeId: "115", promptInputKey: "aspect" });
    expect(moved.has(inputKeyOf("130", "value"))).toBe(false);
    expect(moved.has(inputKeyOf("115", "aspect"))).toBe(true);
  });
});
