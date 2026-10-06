---
name: effect-camera-23
description: 用具体的机位与运动描述控制镜头节奏。 用户要求叠化转场时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 叠化转场
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 叠化转场
        en: Dissolve
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Dissolve: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots: []
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

Slow cross-dissolve, two faces/scenes overlapping before one resolves

Keep each shot’s subjects and internal composition consistent, and preserve the identity and clothing of any recurring person. Allow the setting or time to change between shots as described by the dissolve; change only the dissolve transition.
