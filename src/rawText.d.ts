/**
 * `import text from './x.md?raw'` 的类型声明。
 *
 * 为什么要这一份：仓库没有引 `vite/client` 的全局类型（渲染层 tsconfig 只 include src/），
 * 而「模型页那张卡要把 agent-skills/nomi-add-model/SKILL.md 的**原文**交给用户」必须读到那份文件本身。
 * 走 `?raw` 是为了让 SKILL.md 保持**唯一真相源**：技能包给宿主装的那份、卡里预览的那份、
 * 复制到剪贴板的那份，是同一个字节流。抄一份进 .ts 常量就是第二个真相源，两处必然漂。
 */
declare module '*?raw' {
  const content: string
  export default content
}
