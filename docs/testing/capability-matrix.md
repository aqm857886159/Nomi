# Nomi Product Capability Test Matrix

Capabilities: 23 · uncovered dimensions: 23

## app

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| app.lifecycle | high | 1 | 1 | 0 | 0 | j3-first-success |

## projects

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| projects.library | high | 1 | 1 | 1 | 1 | j3-first-success, j5-edit-export |

## creation

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| creation.agent | high | 2 | 2 | 2 | 1 | j1-promo, j2-story-styling |

## canvas

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| canvas.graph-editing | high | 1 | 1 | 1 | 1 | j1-promo, j3-first-success |

## nodes

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| node.text | medium | 1 | 0 | 0 | 0 | j3-first-success |
| node.image | high | 1 | 1 | 1 | 1 | j2-story-styling, j4-reference |
| node.video | high | 1 | 1 | 1 | 0 | j1-promo, j4-reference |
| node.audio | high | 1 | 1 | 0 | 0 | j5-edit-export |
| node.panorama-whiteboard | medium | 0 | 0 | 0 | 0 | — |

## scene3d

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| scene3d.director | high | 1 | 1 | 1 | 1 | j6-camera-move |

## models

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| models.catalog-parameters | high | 1 | 1 | 1 | 1 | j1-promo |

## references

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| references.assets | high | 1 | 1 | 1 | 1 | j2-story-styling, j4-reference |

## generation

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| generation.execution | high | 1 | 1 | 1 | 1 | j1-promo, j6-camera-move |

## timeline

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| timeline.preview | high | 1 | 0 | 0 | 1 | j5-edit-export |

## export

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| export.media | high | 1 | 1 | 1 | 1 | j5-edit-export |

## settings

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| settings.onboarding | high | 1 | 1 | 1 | 1 | j3-first-success |

## skills

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| skills.runtime | medium | 1 | 1 | 1 | 1 | — |

## prompt-library

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| prompt-library | medium | 1 | 0 | 0 | 1 | — |

## memory

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| memory.project | medium | 1 | 0 | 0 | 1 | — |

## browser-capture

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| browser.capture | medium | 1 | 1 | 0 | 0 | — |

## capability-core

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| capability-core | high | 1 | 1 | 1 | 1 | j1-promo |

## project-agent

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| project-agent.canvas-read | high | 1 | 1 | 1 | 1 | project-agent-mcp, project-agent-surface |

## experience

| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |
|---|---|---:|---:|---:|---:|---|
| experience.window-and-popovers | high | 1 | 0 | 0 | 0 | j3-first-success, j5-edit-export |

## Uncovered dimensions

- app.lifecycle:failure
- app.lifecycle:persistence
- node.text:boundary
- node.text:failure
- node.text:persistence
- node.video:persistence
- node.audio:failure
- node.audio:persistence
- node.panorama-whiteboard:normal
- node.panorama-whiteboard:boundary
- node.panorama-whiteboard:failure
- node.panorama-whiteboard:persistence
- timeline.preview:boundary
- timeline.preview:failure
- prompt-library:boundary
- prompt-library:failure
- memory.project:boundary
- memory.project:failure
- browser.capture:failure
- browser.capture:persistence
- experience.window-and-popovers:boundary
- experience.window-and-popovers:failure
- experience.window-and-popovers:persistence

