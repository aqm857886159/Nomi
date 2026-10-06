---
name: effect-camera-02
description: 用具体的机位与运动描述控制镜头节奏。 用户要求过肩对话时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 过肩对话
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 过肩对话
        en: OTS dialogue
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'OTS dialogue: Add a precise camera or composition instruction to the scene.'
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

Long-lens over-the-shoulder, foreground shoulder soft, focus on the far face, shallow depth of field

Keep every person’s identity, appearance, clothing, setting, lighting, color, and continuity unchanged. Change only the over-the-shoulder framing, lens, and focus described here.
