// 引导示例项目的随包成图清单——唯一定义（主进程 seed、构建产物地址分类器都从这里读）。

/** sidecar kind：既标记来源，也是幂等复用的查找键（重看引导不堆副本）。 */
export const DEMO_ASSET_KIND = "onboarding-demo";

/**
 * clientId → 随包图片文件名。clientId 必须与 `src/workbench/onboarding/demoProject.ts`
 * 里分镜方案的 anchors/shots 一致——`electron/onboarding/demoAssetSeed.test.ts` 锁住这条跨进程约定。
 * rooftop(场景锚)复用屋顶日落镜 shot-8，故 8 个镜头共 10 个 clientId、9 个文件。
 */
export const DEMO_ASSET_FILES: Readonly<Record<string, string>> = Object.freeze({
  kid: "kid.jpg",
  robot: "robot.jpg",
  rooftop: "shot-8.jpg",
  "shot-1": "shot-1.jpg",
  "shot-2": "shot-2.jpg",
  "shot-3": "shot-3.jpg",
  "shot-4": "shot-4.jpg",
  "shot-5": "shot-5.jpg",
  "shot-6": "shot-6.jpg",
  "shot-7": "shot-7.jpg",
  "shot-8": "shot-8.jpg",
});

export const DEMO_ASSET_FILE_NAMES: ReadonlySet<string> = new Set(Object.values(DEMO_ASSET_FILES));
