# ComfyUI Workflow Edit

## Scope

- Fix imported ComfyUI workflow row actions so the hover delete icon is clickable and the enabled badge hides correctly.
- Persist editable import draft data for newly imported ComfyUI workflows.
- Reuse the existing workflow import panel for editing workflows that have stored draft data.

## Non-goals

- Do not change generic model catalog editing.
- Do not reconstruct old imported workflows from templated mapping bodies.
- Do not change built-in ComfyUI txt2img behavior.

## Acceptance

- Imported workflow rows show compact hover actions without blocking clicks.
- Delete still cascades model-specific mappings.
- New imports can be reopened, edited, and saved with the same modelKey.
- Older imported workflows without draft metadata remain usable; they just do not expose edit.
