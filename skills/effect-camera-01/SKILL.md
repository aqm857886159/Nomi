---
name: effect-camera-01
description: 用具体的机位与运动描述控制镜头节奏。 用户要求空镜转场时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 空镜转场
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 空镜转场
        en: Empty-frame bridge
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Empty-frame bridge: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{场景}'
        reference: scene
      source:
        url: https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/f21500e5946973949c6bbf02e67e0c21b2e63a35/templates/camera-move-library.md
        revision: f21500e5946973949c6bbf02e67e0c21b2e63a35
        author: jnMetaCode
        changes: Nomi adds Chinese task labels, reference slots and review criteria; fixed subjects are parameterized where
          noted.
        evidence:
        - https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/f21500e5946973949c6bbf02e67e0c21b2e63a35/templates/camera-move-library.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

Slow drift across an empty {场景}, no subject in frame; hold, then the next shot opens on a matching color/tone

Keep the frame empty and preserve the scene identity, color/tone, and continuity; do not add a person or subject. Change only the drift, hold, and matching transition described here.
