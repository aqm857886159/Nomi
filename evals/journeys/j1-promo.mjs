// J1 产品宣传视频主链路(agent 驱动,需真实模型 catalog)。
// 成功标准(CLAUDE.md):文案 → 拆镜头 → 画布节点排布 → 每镜选好模型配好参数 → 「可以生成了」。
// 多里程碑 = τ-bench 多轮:先拆镜头,再配模型参数,逐步验终态(WebArena 功能性成功)。
// 不真生成(run_generation_batch 不在 TOOL_WHITELIST,会被拒)——验的是「可以生成了」终态。
import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

const PRODUCT_COPY = [
  "我们的新品是一款便携浓缩咖啡机「云雀」:钛灰色金属机身、一键萃取、户外露营也能用。",
  "想做一条 15 秒的宣传短片:清晨山间帐篷外、咖啡师按下按钮、浓缩液缓缓流入杯中、阳光下举杯。",
].join("\n");

export default {
  id: "j1-promo",
  name: "产品宣传视频主链路",
  needsAgent: true,
  smoke: true,
  successCriterion: "拆出镜头节点 + 链式引用 → 每节点绑定可解析模型与画幅参数 → 可以生成了",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "split-shots",
      title: "把宣传文案拆成镜头铺到画布",
      say: `把这段产品宣传文案拆成 4 个镜头铺到画布,每个镜头写好画面提示词,镜头之间按顺序连引用边:\n${PRODUCT_COPY}`,
      verify(ctx) {
        const created = ctx.created();
        const chain = ctx.chainEdges();
        return [
          check("拆出 3-5 个镜头节点", created.length >= 3 && created.length <= 5, `created=${created.length}`, "outcome"),
          check("每个镜头有非空提示词(≥20 字)", created.length > 0 && created.every((n) => String(n.prompt || "").trim().length >= 20), "", "quality"),
          check("镜头按顺序连成链(引用边 ≥ 节点数-1)", chain.length >= Math.max(0, created.length - 1), `edges=${chain.length}`, "outcome"),
          check("节点是可生成的视觉类型(image/video)", created.length > 0 && created.every((n) => ["image", "video"].includes(n.kind)), "", "outcome"),
        ];
      },
    },
    {
      id: "configure-models",
      title: "给每个镜头选好模型和画幅,准备生成",
      say: "给画布上每个镜头都选好合适的模型和画幅比例(竖屏短视频),把参数配齐,准备生成。",
      verify(ctx) {
        const created = ctx.created();
        const missingModel = created.filter((n) => !n.meta?.modelKey || !n.meta?.archetype?.id);
        const missingRatio = created.filter((n) =>
          n.kind === "image" ? !n.meta?.size : n.kind === "video" ? !n.meta?.aspect_ratio || !n.meta?.duration : false,
        );
        return [
          check("每个节点绑定可解析模型(modelKey+archetype)", missingModel.length === 0, missingModel.length ? `${missingModel.length} 个缺模型` : "", "outcome"),
          check("每个节点带齐画幅/时长参数(可以生成了)", missingRatio.length === 0, missingRatio.length ? `${missingRatio.length} 个缺比例/时长` : "", "outcome"),
        ];
      },
    },
  ],
};
