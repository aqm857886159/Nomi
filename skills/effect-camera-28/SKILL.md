---
name: effect-camera-28
description: 用具体的机位与运动描述控制镜头节奏。 用户要求主观视角时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 主观视角
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 主观视角
        en: Subjective POV
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Subjective POV: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{主体}'
        reference: subject
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

First-person POV, the camera is {主体}'s eyes, frame sways with gait and breath

Keep the first-person subject’s identity, viewpoint, setting, lighting, color, and continuity unchanged. Change only the eye-level sway with gait and breath described here; do not add an external observer.
