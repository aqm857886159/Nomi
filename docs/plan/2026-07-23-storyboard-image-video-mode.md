# Storyboard Image+Video Mode Plan

## Goal

Add a third storyboard shot option, "图片+视频", for video storyboards that should generate a per-shot first-frame image before generating the video. The first-frame image must be able to reference character, scene, prop, and style anchors; the video then references that first-frame image through the existing `first_frame` edge.

## Root Cause

The current storyboard IR can express only one canvas product per logical shot: `shotKind: "image"` creates an image node, and `shotKind: "video"` creates a video node. When the model tries to satisfy "image reference + video" today, it emits two `shots[]` entries per logical shot. That doubles an 18-shot plan into 36 `shots[]`, exceeds the schema max of 24, duplicates shot numbers, and invents non-anchor ids such as `image-1`.

## Scope

- Extend the storyboard plan schema with an optional per-shot `keyframe` object.
- Add a UI shot-type option named "图片+视频".
- Teach the storyboard planner skill and launch prompt to use one logical `shot` with `shotKind: "video"` and `keyframe.enabled: true`.
- Update storyboard plan landing so image+video shots create:
  - one keyframe image node,
  - one video node,
  - anchor reference edges into the keyframe image,
  - one `first_frame` edge from keyframe image to video.
- Add focused tests for the conversion and schema behavior.

## Non-Goals

- Do not increase the 24 logical-shot limit.
- Do not change existing image-only or video-only storyboard behavior.
- Do not create a second storyboard pipeline.
- Do not alter generation runtime reference resolution, because `first_frame` image-to-video support already exists.
- Do not introduce provider-specific model logic in the storyboard IR.

## Data Shape

Keep `shotKind` as the existing two-value domain:

```ts
type PlanShot = {
  shotKind?: "image" | "video"
  keyframe?: {
    enabled?: boolean
    prompt?: string
    modelKey?: string
    modeId?: string
    params?: Record<string, unknown>
  }
}
```

Interpretation:

- `shotKind: "image"`: image-only, ignore `keyframe`.
- `shotKind: "video"` without `keyframe.enabled`: current video-only behavior.
- `shotKind: "video"` with `keyframe.enabled`: image+video mode.

## UX

In the storyboard editor shot card, the type selector becomes:

- 图片
- 视频
- 图片+视频

For the first implementation, the existing prompt textarea remains the video prompt in image+video mode, and a compact first-frame prompt textarea appears under the header. This is enough for review/edit before landing; detailed per-keyframe model controls can come later if needed.

## Landing Rules

For an image+video shot with index `N`:

- Keyframe node clientId: `shot-N-keyframe`
- Keyframe node kind: `image`
- Keyframe title: `镜头 N 首帧`
- Video node clientId: `shot-N`
- Video node kind: `video`
- Anchor visual edges target the keyframe node.
- Text anchors are folded into the keyframe prompt and the video prompt.
- Add `{ sourceClientId: "shot-N-keyframe", targetClientId: "shot-N", mode: "first_frame" }`.

This produces dependency waves naturally: anchors first, keyframes second, videos third.

## Compatibility

- Old plans with no `keyframe` continue to parse and land as before.
- Existing image storyboard plans continue to produce image nodes only.
- Existing video storyboard plans continue to produce video nodes only.
- Timeline fallback already understands generated keyframes feeding video shots, so no timeline change is planned.

## Rollback

Revert the changes in:

- `electron/ai/canvasTools.ts`
- `skills/workbench-storyboard-planner/SKILL.md`
- `src/workbench/generationCanvas/agent/storyboardLauncher.ts`
- `src/workbench/generationCanvas/agent/storyboardPlan.ts`
- storyboard editor UI/i18n files
- focused tests

Because the new field is optional, rollback does not require data migration.

## Verification

- `pnpm vitest run src/workbench/generationCanvas/agent/storyboardPlan.test.ts`
- `pnpm vitest run src/workbench/generationCanvas/agent/storyboardPlanEdits.test.ts`
- `pnpm vitest run electron/ai/canvasTools.test.ts`
- `pnpm run typecheck`

