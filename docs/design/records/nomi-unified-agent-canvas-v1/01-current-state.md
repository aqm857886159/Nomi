# Current-state evidence · v1

This is the input given to image generation. The referenced images are existing Nomi real-page walkthrough/review captures, not invented wireframes.

## Reference images

1. Agent + generation workbench: `docs/design/reviews/2026-08-30-agent-interaction/02-agent-host-desktop.png`
2. Generation workspace with canvas, Agent and timeline: `docs/design/reviews/2026-08-30-agent-interaction/06-generation-default.png`
3. Existing workbench onboarding/tour: `docs/design/reviews/2026-06-12-start-v3-c-workbench-tour.png`

## Existing code anchors

| Area | Existing evidence | What the exploration must preserve or clarify |
|---|---|---|
| Agent shell | `src/workbench/ai/ProjectAgentResidentShell.tsx` | Keep one shell and one conversation; make the spatial states legible. |
| Prompt input | `src/workbench/ai/composer/AutoGrowTextarea.tsx` | Preserve auto-grow/internal-scroll behavior; explore small/large editor affordance. |
| Workbench state | `src/workbench/workbenchStore.ts` | Current dock collapse/width exists; fullscreen is a missing state. |
| Workspaces | `src/workbench/WorkbenchShell.tsx` | Runtime has four modes; product visual should read as three main work surfaces. |
| Creation storyboard | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`, `StoryboardShotTable.tsx` | This is the authored `分镜计划`, not source-video analysis. |
| Video analysis | `electron/video/deconstructVideo.ts` | Existing result fields include keyframe, visual, on-screen text, dialogue, mood and prompts. |
| Current deconstruction UI | `src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx` | Current right Portal is a known UX problem; do not preserve it as the final composition. |
| Image-node extraction | `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts` | Current automatic image-node pile is a known anti-pattern; show an embedded table instead. |
| Existing onboarding | `src/workbench/onboarding/OnboardingChecklist.tsx`, `onboardingState.ts` | Extend the current `上手 N/4` and JourneyTour; do not create a second state source. |
| Design system | `docs/design/nomi-design-system.md` | Token-only, dense, light/dark, Tabler icons, explicit control hierarchy. |

## Current user-visible friction to solve

- right-side deconstruction panel competes with Agent and squeezes the work area;
- source-video keyframes become a visually confusing pile of image nodes;
- outputs can be visible in the conversation but are not persistently easy to find;
- the user cannot tell whether a card is a Skill, a prompt, a model, or a result;
- workspace mode count and product-level three-surface mental model do not fully match;
- small navigation and help affordances are easy to miss when the canvas is empty.

## Evidence boundary

This reference set can support visual direction only. It does not prove the future fullscreen state, new node contracts, TikHub live access, provider fallback, persistence, or video playback implementation.

