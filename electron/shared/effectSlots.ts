/**
 * 效果模板的插槽展开：有值就替换，没值就用通用说法——**绝不把 `{角色名}` 这样的花括号原文发给模型**。
 *
 * 为什么在这里：效果正文（`skills/effect-*` 的 SKILL.md）里的 `{角色名}` `{主体}` `{场景}` 是
 * 声明在 `metadata.nomi.library.slots` 里的占位符，但此前没有任何一处按它展开——库把正文原样交给
 * 生成框 / 一键派生，用户没手改就原样发给了模型。库投影（`curatedPrompts.ts`）是正文离开
 * 效果库的唯一出口，在这一处展开，所有入口（生成框 chip、效果库、一键派生）一次治好。
 *
 * 没值时的通用说法：角色 / 场景 / 主体用对应名词（模板写的是「以参考中的{角色名}」，
 * 换成「以参考中的角色」读起来仍是完整的一句）；正文是英文时用英文名词；文字类插槽（`{剧本文字}`、
 * `{hands/eyes}`）本来就是描述性的词，去掉花括号即可。
 */
export type EffectSlot = Readonly<{ token: string; reference: "character" | "scene" | "subject" | "text" }>;

const GENERIC_ZH = { character: "角色", scene: "场景", subject: "主体" } as const;
const GENERIC_EN = { character: "character", scene: "scene", subject: "subject" } as const;
const CJK = /[㐀-鿿]/;

export function resolveEffectSlots(
  prompt: string,
  slots: readonly EffectSlot[],
  values: Readonly<Record<string, string>> = {},
): string {
  const outsideTokens = slots.reduce((text, slot) => text.split(slot.token).join(""), prompt);
  const generic = CJK.test(outsideTokens) ? GENERIC_ZH : GENERIC_EN;
  return slots.reduce((text, slot) => {
    const value = values[slot.token]?.trim();
    const fallback = slot.reference === "text" ? slot.token.slice(1, -1) : generic[slot.reference];
    return text.split(slot.token).join(value || fallback);
  }, prompt);
}
