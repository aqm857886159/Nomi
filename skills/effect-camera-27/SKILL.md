---
name: effect-camera-27
description: 用具体的机位与运动描述控制镜头节奏。 用户要求声音转场时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 声音转场
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 声音转场
        en: Sound bridge
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Sound bridge: Add a precise camera or composition instruction to the scene.'
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

Carry the next scene's sound in before the picture cuts

Keep the picture’s subjects, composition, lighting, color, and continuity consistent within each shot, and preserve any recurring subject’s identity and clothing. Allow the next scene’s setting, time, and sound to change as described; change only the sound bridge.
