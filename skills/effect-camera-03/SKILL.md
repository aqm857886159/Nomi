---
name: effect-camera-03
description: 用具体的机位与运动描述控制镜头节奏。 用户要求特写情绪时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 特写情绪
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 特写情绪
        en: Emotion close-up
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Emotion close-up: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{hands/eyes}'
        reference: text
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

Extreme close-up on {hands/eyes}, micro-movement only, a tremor / a tightening grip

Keep the referenced hands or eyes, their identity and appearance, the setting, lighting, color, and continuity unchanged. Change only the extreme close-up and the tiny tremor or grip movement described here.
