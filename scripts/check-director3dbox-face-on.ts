// 开关开那张工具面的 CI job 的第一步：**先证明开关真的开了**，再跑整族门岗。
//
// 那几道门岗（model-schema / tool-face / model-face-frozen / usecases / skill-tool-binding）按开关关时
// 同样是绿的——环境变量没传到、或者传错了名字，它们就会安安静静地验一遍开关关的那张面，然后报绿。
// 这一步把「验的是哪张面」变成一个会红的事实（fail-closed），而不是写在 YAML 里的一句期望。
//
// 开关只经环境变量传（`NOMI_DESKTOP_DEV=1 NOMI_DIRECTOR_3DBOX=true`），不靠 `-- --flag` 透传：
// `node --test` 不收额外参数，透传到不了门岗进程。到期 2026-11-15 随开关一起删。
import "../electron/shared/featureFlags/director3dbox";
import { director3dBoxFaceEnabled } from "../electron/shared/featureFlags/director3dboxFace";
import { modelFacingToolSpecs } from "../electron/shared/agentCapabilities/modelFacingToolRegistry";

const stageShot = modelFacingToolSpecs("internal").find((spec) => spec.name === "stage_shot");
if (!director3dBoxFaceEnabled() || stageShot?.contractId !== "director.write") {
  console.error(
    "✖ 3D-BOX 开关没有在门岗进程里打开（需要 NOMI_DESKTOP_DEV=1 NOMI_DIRECTOR_3DBOX=true），"
    + `stage_shot 现在指向 ${stageShot?.contractId ?? "（没有装配）"}——后面的门岗会验成开关关的那张面。`,
  );
  process.exit(1);
}
console.log("✅ 3D-BOX 开关已在门岗进程里打开：stage_shot → director.write");
