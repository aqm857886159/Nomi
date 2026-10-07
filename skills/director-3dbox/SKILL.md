---
name: director-3dbox
description: 3D-BOX 导演预演工作流——一句话搭出白盒场景、走位和多镜机位，按实测景别 / 运镜对照用户的话，聊着按名字改，用户满意后把整段预演当参考视频交给生成环节。仅在开启 3D-BOX 的构建里可选。
metadata:
  nomi:
    selectable-in-workbench: true
    requires-flag: director3dbox
    audience: internal
    version: 1.1.0
    tools:
      - look_at_canvas
      - stage_shot
      - undo
      - draft_shots
      - list_models
      - generate
    required-providers:
      - video
    library:
      kind: skill
      title:
        zh-CN: 3D-BOX 预演
        en: 3D-BOX previs
      summary:
        zh-CN: 一句话搭白盒场景、走位和多镜机位，看实测预演、按名字改，满意后把预演当参考视频去出片。
        en: Block a gray-box scene with actors and cameras from one sentence, check the measured preview, revise by name, then use it as the reference video.
      appliesTo:
      - video
      group:
        zh-CN: 导演
        en: Directing
      slots: []
      source:
        url: https://github.com/aqm857886159/Nomi/blob/a6e067250e1bd8494cceaa16663f0fcaad399ebd/docs/plan/2026-10-04-director-3dbox-phase3.md
        revision: a6e067250e1bd8494cceaa16663f0fcaad399ebd
        author: Nomi contributors
        changes: Nomi writes this workflow from section 9 of the 3D-BOX phase-3 plan.
        evidence:
        - https://github.com/aqm857886159/Nomi/blob/a6e067250e1bd8494cceaa16663f0fcaad399ebd/docs/plan/2026-10-04-director-3dbox-phase3.md
      preview:
        path: assets/cover.png
        type: image
        provenance: local-output
license: AGPL-3.0-only
---

# 3D-BOX 导演预演

用户想先看「这场戏怎么站、怎么拍」再出片时用：他描述一场戏、一组镜头，或者对已有预演说「第二镜改成特写」。
计划只写意图（谁在哪、做什么、每一镜怎么框怎么动），坐标和机位都由 Nomi 的编译器算，再由测量模块把每一镜实测出来。
镜头语言（景别、角度、运镜的情绪含义）参考 `director-cinematography` 技能，这里不重复。

## 工作流

1. **先看画布**：用 look_at_canvas 找到要做预演的那一镜（视频镜头节点）。画布上已经有 3D-BOX 节点时，记下它那一行的 revision、镜头名和角色名——之后改它就用这些名字。
2. **第一次搭**：用 stage_shot 交一份完整的导演计划。要给某一镜做预演，就把那一镜的节点 id 放进 target；用户只是想先看看，就不给 target，做一个独立预演。
3. **对照实测**：结果里有每一个 cut 的实测景别和运镜、问题清单、规范化后的完整计划。逐镜和用户的原话对照；对不上的（景别量出来不对、主体出画、穿模）按名字改，**最多再改两三轮**，然后如实告诉用户哪里已经对上、哪里还差。
4. **请用户看预演**：用一句话讲清每一镜实测是什么（例如「第 1 镜全景固定，第 2 镜特写推近」），并说出动作库里没有、会写进提示词交给视频模型去演的细节动作。
5. **聊着改**：用户要改哪里，就只交改动的那几处，用上一次结果里的 revision；不要把整份计划重写一遍。结果说没有变化时，直接告诉用户「已经是这样了」。用户发消息时如果带着一条「director.shot」上下文（他在导演台里选中了某一镜），没说改哪一镜就是改那一镜：用那条上下文里的导演节点、修订号和镜头名。
   用户在精修里亲手调过的东西默认保留。结果里 reorderedOverrides 不为空，说明这次改动直接改到了他手调过的地方、那几处手调已按新指令重算——要一条条告诉他（例如「第 2 镜的机位你手调过，已按特写重算；说撤销就能回到你调的样子」）。changedEntities 是没被点名、但跟着变了的东西（例如挪了一个人，拍他的机位跟着重算），简短说一句即可，上面的手调照样保留。
6. **撤销**：用户说撤销、改回去，就用 undo 撤掉上一次 stage_shot 结果里的那个 changeId。
7. **出片**：用户明确说「就用这个出片」之后，交给生成环节（generate）。预演还在渲染或者渲染失败时，先把原因告诉用户，等预演好了（look_at_canvas 那一行显示 ready）再来；失败的预演请用户在节点上点「重试预演」，太长的就把计划缩短。
8. **让预演真正进到这一镜的草稿里**：预演好了以后，look_at_canvas 那一行会给出 `previewAssetId`。生成环节拒绝并说「草稿没有用上预演」时，用 draft_shots 改这一镜（同一个 operationId 和 shotId）：把这个素材 id 放进 references，模式换成这个模型能收参考视频的那个（用 list_models 查），只改这两件，提示词别动；改完再交给生成环节。

## 计划怎么写

- 用户提到的人、车、物、地点，原词抄进角色描述、场景标签或场景件，起一个看得懂的英文名字当 id（「图书管理员」→ librarian），之后所有地方都用这个名字。
- 镜头按时间排，窗口用秒，首尾相接；只有镜头要从上一镜的结尾接着走时才用连续转场。
- 两人对话的正反打，全场保持在轴线的同一侧；过肩镜头写清是越过谁的肩。
- 每一镜只要一个主要运镜；用户没要求运动就用固定机位，不要为了「有动感」加运镜。
- 预演最长 10 秒；一场戏更长时，拆成两段预演分别挂到两个镜头上。

## 三份范例（场景都不取自评测题库）

**图书馆还书**：「图书管理员把书递给学生，正反打，最后慢慢推近学生。」
场景选 room，标签写「图书馆」；两个角色 librarian、student，学生站在管理员面前；三镜——0–3 秒全景固定交代两人，3–6 秒越过学生肩膀拍管理员中景，6–9 秒越过管理员肩膀拍学生、慢速推近。

**洗车店**：「工人绕着一辆车擦车窗，镜头低机位跟着他横移。」
场景选 street，标签写「洗车店」；角色 worker（人）和 car（车辆，停在路面锚点上）；走位是工人绕车走；两镜——0–4 秒低机位全景跟着工人横移，4–7 秒中近景固定拍他擦车窗。

**公交站**：「老人在站台等车，公交车进站停下，先全景再给老人中景。」
场景选 street，标签写「公交站」；角色 old_man（人）和 bus（车辆，沿路面驶入后停下）；两镜——0–4 秒远景固定看公交进站，4–8 秒中景固定拍老人抬头看车。
