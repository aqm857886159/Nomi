# Prompt Brief · Nomi unified Agent + canvas · v1

- featureId: `nomi-unified-agent-canvas-v1`
- use case: `ui-mockup`
- output: product UI visual exploration, not a marketing poster, not concept art
- status: `awaiting-user-confirmation`
- changedVariable: `workspace-composition-and-information-hierarchy`
- inheritedFrom: the three real Nomi screenshots supplied as local references

## Prompt

Create a high-fidelity desktop product UI redesign exploration for Nomi, a local-first AI video creation workbench. Use the attached real Nomi screenshots as the primary reference for the existing shell, proportions, light neutral palette, dense production-oriented layout, typography hierarchy, canvas grid, Agent dock, and current Chinese UI language. Do not redesign the brand from scratch and do not turn the result into a glossy marketing landing page.

Show one Nomi project workspace at a wide desktop viewport. The visual hierarchy should be: a narrow fixed left rail for project, asset library, Skill library, the three main user-facing surfaces (剧本创作, 图文视频创作, 剪辑), and settings; a large central React-Flow-like canvas with a subtle grid; one clear Agent shell on the right; a small persistent result indicator that does not push the conversation downward; and a calm onboarding/Skill empty state that tells a new user what to do next.

The central canvas should contain a readable, compact example of the intended video workflow: a video source node with a thumbnail and a short “粘贴链接 / 从素材库选择” affordance, connected to one “视频拆解表” node. The table node should contain rows with small embedded keyframes and visible columns such as 镜头, 时间, 关键帧, 画面动作, 字幕/对白, 花字, 情绪, 图片 Prompt, 视频 Prompt. Do not create a wall of extracted image nodes. To the right, show only one or two explicitly generated output nodes connected from selected rows. Keep the table as a canvas artifact, not as a large separate web spreadsheet.

Make the Agent shell feel like the same Nomi Agent in a focused state, not a second application. Its header should have project context, collapse and focus/fullscreen affordances. Its conversation area should show a short natural-language request, one compact progress/result event, and a media/table result entry that can be opened without permanently occupying the chat. Its composer should visibly contain exactly five primary controls in this order: plus for materials/references, model, Skill/context, mode, send/generate; leave intentional breathing room in the middle. Show the prompt field in a short initial state with the possibility of growing, internally scrolling, and switching to a larger editing state. Use small Tabler-like icons with clear hover/selected affordances, but do not add icon noise.

In the empty/first-run area, show three concrete task cards rather than a blank white box: “剧本创作 Skill”, “电影感图文视频 Skill”, and “视频拆解 Skill”. Each card should have a small relevant image/video-like preview area, a title, one-line explanation, and a clear “加入 Skill / 开始” action. The cards must feel like onboarding for an existing production tool, not an app-store marketplace.

Preserve the existing Nomi visual character: restrained off-white/paper surfaces, ink text, subtle borders, sparse accent color, dense but breathable spacing, modest corner radii, minimal shadows, and no purple AI glow, starburst decoration, oversized hero typography, or generic floating dashboard cards. Use Chinese labels where visible; if exact Chinese text cannot be rendered reliably, keep text short and structurally legible rather than inventing long gibberish.

The composition must make the next action obvious within three seconds: “选择一个 Skill 或资料，然后在 Agent 里说清楚目标；产物会在画布里继续工作。” Keep global navigation visible even in the focused Agent state so the user never loses project location. Show a small lower canvas chrome for zoom, reset view, and help/shortcuts, inspired by the attached onboarding reference but adapted to Nomi’s existing design system.

This is one visual variable exploration: change the spatial composition and information hierarchy while preserving Nomi’s existing brand, density, component language, and capability boundaries. Do not depict unsupported features as working. Mark the output as an exploration draft.

## Visual review questions

1. Is the canvas clearly the main work surface?
2. Can the user find the Agent without the Agent taking over the whole product?
3. Is the video deconstruction result unmistakably a table with embedded keyframes rather than a pile of images?
4. Are the five composer controls and the small navigation icons understandable?
5. Does the onboarding area provide a concrete next action without blocking a long conversation?

