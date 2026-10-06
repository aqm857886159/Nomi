/**
 * 导演计划**写法指导**的唯一 owner（方案 §3「计划写法指导」）：`stage_shot` 的 `promptGuidelines` 直接用它，
 * 评测规划器应拼同一份文本（规划器归 S1 线，接入请求已记在 3b 报告里）。
 *
 * 只写「怎么想」，不复述 schema 已经说清的合法值（景别 / 运镜 / 关系的枚举都在字段描述里），
 * 范例不取评测题库里的任何一道题。英文：进系统提示词的指导文字按 A3 只收英文。
 */
export const DIRECTOR_PLAN_MODEL_GUIDELINES = Object.freeze([
  "A director plan states intent only: who is where relative to what, what they do over time, and how each shot frames and moves. Never write coordinates, distances or camera positions; Nomi's compiler solves all geometry and measures the result.",
  "Copy every person, vehicle, product and named place from the user's words verbatim into actors[].desc, scene.tags or setPieces[].kind, give each a readable ASCII id derived from that noun (\"waiter\" for a waiter, not \"actor1\"), and reuse exactly those ids in blocking, shots[].subject and placement refs.",
  "Place actors and set pieces against the fixed template anchors: street = s1-street-ground, s1-street-road-left, s1-street-road-right, s1-street-building-left, s1-street-building-right; room = s1-room-floor, s1-room-back, s1-room-left; courtyard = s1-courtyard-ground, s1-courtyard-wall-north, s1-courtyard-wall-east, s1-courtyard-gate, s1-courtyard-tree; product_stage = s1-product-ground, s1-product-backdrop, s1-product-pedestal. Pick the closest template by spatial layout; keep the real place name in scene.tags.",
  "Shots cover the brief in time order with second-based windows and no gaps. Use transitionIn continuous only when the camera should carry on from where the previous shot ended. Shot/reverse-shot coverage of two people keeps one side of the axis for the whole scene.",
  "To change an existing plan, send only the edits the user asked for, addressed by name (/shots/<name>/size, /actors/<name>/placement); everything else stays as it is. If the result says unchanged, tell the user it already is that way instead of rewriting.",
  "Read the returned issues and measured cuts. Fix real problems in at most two or three more calls, then tell the user what the preview now shows and what still differs.",
  "The user may hand-adjust the preview in the editor; a patch keeps those adjustments. When a result lists reorderedOverrides, tell the user each one: it was his own adjustment that this instruction directly overrode, it has been recomputed for the new instruction, and undo brings it back. When it lists changedEntities, say in one sentence what moved along with the change; his adjustments on those are kept.",
]);
