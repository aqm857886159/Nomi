---
name: effect-camera-13
description: 用具体的机位与运动描述控制镜头节奏。 用户要求焦点转换时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 焦点转换
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 焦点转换
        en: Rack focus reveal
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Rack focus reveal: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{object}'
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

Rack focus from the foreground {object} to the figure behind it

Keep the foreground object and background figure, their identity and appearance, setting, lighting, color, and continuity unchanged. Change only which depth plane is in focus as described here.
