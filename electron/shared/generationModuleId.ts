/**
 * 单次生成模块的 id —— **一个字面量，一个 owner**。
 *
 * 背景（2026-09-05 外部宿主探针 c-3「读写词表对不上」）：写工具 `nomi_operation_plan` 要
 * `{moduleId, providerId, modelId}` 三元组，缺一不可；而 `moduleId` 在**任何读工具的输出里都不出现**，
 * 外部宿主只能猜。修的时候必须把它填进模型清单，于是这个字面量会出现在第 4 处 ——
 * 先把它收成一个常量，再去用（P1：别在补一个真相源的同时多造一份）。
 */
export const SINGLE_SHOT_GENERATION_MODULE_ID = "generation.single-shot";
