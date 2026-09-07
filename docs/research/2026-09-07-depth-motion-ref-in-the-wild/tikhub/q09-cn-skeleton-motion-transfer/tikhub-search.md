# TikHub 自媒体检索：「骨架视频 动作迁移」

- 抓取时间：2026-09-07T02:51:22.516Z
- 关键词：`骨架视频 动作迁移`
- 平台：抖音(20) · B站(20) · 小红书(20)
- 合计 60 条

> 摘要是**原文前 300 字**，没有任何 AI 改写；`framework/tool` 是正则抽取的提及，不是判断。
> 标 `best-effort-unverified` 的平台字段路径未经真实响应核对，读结论时以 URL 原文为准。

## 本轮对账

| 平台 | 状态 | 条数 | 页数 | 缺字段 | 字段路径 |
|---|---|---|---|---|---|
 | 抖音 | ✓ | 20 | 3 | （无） | 已核对 2026-09-06 | 
 | B站 | ✓ | 20 | 1 | （无） | 已核对 2026-09-06 | 
 | 小红书 | ✓ | 20 | 1 | （无） | 已核对 2026-09-06 | 

## 抖音（20 条）

### seedance2.0 稳定动作迁移新玩法，适合小白 参考视频来源：@鱼肉肉ɞ 
用K3做了一个视频转深度视频+骨骼绑定的skill，用来做动作迁移。
告诉kimi，帮我做一个把普通视频转换成带骨骼绑定的深度视频的Skill。
只需要以下提示词+内容描述就能完成动作迁移
【@video1 为动作与空间参考：骨骼轨迹定义动作与时序，须严格还原，不得增删动作或改变节奏；深度图仅表达空间纵深与运镜，禁止模仿其颜色与质感。在此约束下生成——（你需要生成的内容）】
优点：
1. 动作保真度更高——模型不必同时做"姿态估计+生成"两件事，骨骼轨迹直接钉死关节时序，快动作、旋转、大幅度舞蹈这类容易丢动作的场景收益最大（你那条舞者素材就是典型）。
2. 杜绝风格串味——原片的色调、光影、胶片感极易被当成目标风格迁移过去；深度骨骼里没有这些信号，提示词里的风格描述独占解释权。
3. 背景不粘连——原视频的街景、观众、杂物会污染生成场景；深度图只保留"哪近哪远"，不保留"那是什么"。
4. 弱光/低质素材可用——夜拍、噪点多的素材直接参考会让模型学到脏画质；转成深度骨骼后噪声被抹平，只剩干净结构。5. 规避肖像与版权——参考里没有人脸和可辨识形象，商业使用更干净。
缺点：
丢失手指细节、面部表情、衣物飘动这些骨骼和深度都不承载的信息（Seedance 对这部分只能自由发挥）；
人与物体交互（踢球、持剑）的关系变弱——深度图里有物体轮廓但没有语义。

 #aigc应用 #即梦ai生成视频 #kimi #k3 #AI教学

- 出处：https://www.douyin.com/video/7667078251226942763
- 平台 / 作者：抖音 · 诺皮克NovaPix
- 发布时间：2026-07-27T05:39:32.000Z
- 提到的框架/工具：aigc、kimi、Seedance、即梦

> seedance2.0 稳定动作迁移新玩法，适合小白 参考视频来源：@鱼肉肉ɞ 用K3做了一个视频转深度视频+骨骼绑定的skill，用来做动作迁移。 告诉kimi，帮我做一个把普通视频转换成带骨骼绑定的深度视频的Skill。 只需要以下提示词+内容描述就能完成动作迁移 【@video1 为动作与空间参考：骨骼轨迹定义动作与时序，须严格还原，不得增删动作或改变节奏；深度图仅表达空间纵深与运镜，禁止模仿其颜色与质感。在此约束下生成——（你需要生成的内容）】 优点： 1. 动作保真度更高——模型不必同时做"姿态估计+生成"两件事，骨骼轨迹直接钉死关节时序，快动作、旋转、大幅度舞蹈这类容易丢动作的场景…

### 最强动作迁移，再复杂的视频也能完美复刻 #comfyui  #AI  #ai创作者计划  #ai创作浪潮计划  #comfyui教程

- 出处：https://www.douyin.com/video/7638643743138123062
- 平台 / 作者：抖音 · 青橙Lab
- 发布时间：2026-05-11T14:39:09.000Z
- 提到的框架/工具：comfyui、ComfyUI

> 最强动作迁移，再复杂的视频也能完美复刻 #comfyui #AI #ai创作者计划 #ai创作浪潮计划 #comfyui教程

### 做了一个视频转深度图skill 使用这个skill ，你只要把视频丢个agent 然后使用我这个skill 就可以转深度图与带人物动作骨骼。

- 出处：https://www.douyin.com/video/7667879742560914740
- 平台 / 作者：抖音 · 白无常C4D
- 发布时间：2026-07-29T09:29:41.000Z
- 提到的框架/工具：（无）

> 做了一个视频转深度图skill 使用这个skill ，你只要把视频丢个agent 然后使用我这个skill 就可以转深度图与带人物动作骨骼。

### AI动作迁移升级了，动漫体型也能精准适配 #c罗 #siu #世界杯 #动作迁移 #功夫

- 出处：https://www.douyin.com/video/7656747667749375259
- 平台 / 作者：抖音 · 阿凉玩什么
- 发布时间：2026-06-29T09:31:33.000Z
- 提到的框架/工具：siu

> AI动作迁移升级了，动漫体型也能精准适配 #c罗 #siu #世界杯 #动作迁移 #功夫

### 一招解决图声视频最容易翻车的问题 #每天学点ai #ai技巧分享 #短视频干货分享 #AI提示词 #提示词

- 出处：https://www.douyin.com/video/7676121693992349690
- 平台 / 作者：抖音 · 火乐（AI成长版）
- 发布时间：2026-08-20T23:54:00.000Z
- 提到的框架/工具：（无）

> 一招解决图声视频最容易翻车的问题 #每天学点ai #ai技巧分享 #短视频干货分享 #AI提示词 #提示词

### 一段深度视频，AI就能精准复刻所有动作
#AI视频#深度视频#动作迁移#动作复刻 #AI

- 出处：https://www.douyin.com/video/7680915189902965477
- 平台 / 作者：抖音 · 刘量AI
- 发布时间：2026-09-02T12:33:48.000Z
- 提到的框架/工具：（无）

> 一段深度视频，AI就能精准复刻所有动作 #AI视频#深度视频#动作迁移#动作复刻 #AI

### 别再折腾MiniMax动作迁移了！实测后我还是选Scail2 #aigc#学习#comfyui#动作迁移

- 出处：https://www.douyin.com/video/7678604649183726857
- 平台 / 作者：抖音 · 继续微笑
- 发布时间：2026-08-27T07:07:49.000Z
- 提到的框架/工具：aigc、comfyui、ComfyUI、Scail2

> 别再折腾MiniMax动作迁移了！实测后我还是选Scail2 #aigc#学习#comfyui#动作迁移

### blender骨骼重映射教程
#blender #教程 #oc #游戏 #模型

- 出处：https://www.douyin.com/video/7638113423935487603
- 平台 / 作者：抖音 · GZY大王
- 发布时间：2026-05-10T04:21:05.000Z
- 提到的框架/工具：blender、Blender

> blender骨骼重映射教程 #blender #教程 #oc #游戏 #模型

### #动作迁移 #跳舞视频 #ai工具

- 出处：https://www.douyin.com/video/7638560429249911771
- 平台 / 作者：抖音 · 杪冬
- 发布时间：2026-05-11T09:15:42.000Z
- 提到的框架/工具：（无）

> #动作迁移 #跳舞视频 #ai工具

### 别再折腾MiniMax动作迁移了！实测后我还是选Scail2 #aigc#学习#comfyui#动作迁移

- 出处：https://www.douyin.com/video/7678604649183726857
- 平台 / 作者：抖音 · 继续微笑
- 发布时间：2026-08-27T07:07:49.000Z
- 提到的框架/工具：aigc、comfyui、ComfyUI、Scail2

> 别再折腾MiniMax动作迁移了！实测后我还是选Scail2 #aigc#学习#comfyui#动作迁移

### Blender极速K帧小技巧🦾 最近发现用auto rig Pro插件来重映射骨骼动作，K帧效率直接拉满～

#建模 #Blender #blender教程 #3d制作 #渲染

- 出处：https://www.douyin.com/video/7666035204851454031
- 平台 / 作者：抖音 · 小哈是最可爱的
- 发布时间：2026-07-25T11:01:00.000Z
- 提到的框架/工具：blender、Blender

> Blender极速K帧小技巧🦾 最近发现用auto rig Pro插件来重映射骨骼动作，K帧效率直接拉满～ #建模 #Blender #blender教程 #3d制作 #渲染

### 超强视频人物替换、动作迁移工作流教程来了 舞蹈视频、经典画面一键复刻#AI视频 #动作迁移 #人物替换  #comfyui工作流 #nsfw

- 出处：https://www.douyin.com/video/7654151796205669672
- 平台 / 作者：抖音 · AI绘画冉冉（进👗领取）
- 发布时间：2026-06-22T09:38:15.000Z
- 提到的框架/工具：comfyui、ComfyUI、nsfw

> 超强视频人物替换、动作迁移工作流教程来了 舞蹈视频、经典画面一键复刻#AI视频 #动作迁移 #人物替换 #comfyui工作流 #nsfw

### 阿里开源视频人物替换，能实时、低延迟的实现动作、表情迁移！ #animate2 #p视频 #ai干货 #ai教程 #大数据推荐给有需要的人

- 出处：https://www.douyin.com/video/7672327603813993769
- 平台 / 作者：抖音 · 赛博小凡
- 发布时间：2026-08-10T09:09:41.000Z
- 提到的框架/工具：animate2

> 阿里开源视频人物替换，能实时、低延迟的实现动作、表情迁移！ #animate2 #p视频 #ai干货 #ai教程 #大数据推荐给有需要的人

### 舞蹈动作迁移 测试了一套动作迁移的工作流，虽然人脸有点穿模但是动作还原100%，最主要的是可以免费本地部署。#AIGC #Ai制作 #动作迁移 #知识分享 #上热门🔥 @DOU+小助手 @DOU+上热门

- 出处：https://www.douyin.com/video/7681921691294948468
- 平台 / 作者：抖音 · Windx
- 发布时间：2026-09-05T05:39:34.000Z
- 提到的框架/工具：AIGC

> 舞蹈动作迁移 测试了一套动作迁移的工作流，虽然人脸有点穿模但是动作还原100%，最主要的是可以免费本地部署。#AIGC #Ai制作 #动作迁移 #知识分享 #上热门🔥 @DOU+小助手 @DOU+上热门

### minimax-h3动作迁移 

- 出处：https://www.douyin.com/video/7673525268505875899
- 平台 / 作者：抖音 · 轮回
- 发布时间：2026-08-13T14:37:08.000Z
- 提到的框架/工具：（无）

> minimax-h3动作迁移

### 用AI深度视频做动作迁新玩法｜更稳更灵活 以前我们做AI视频，经常会受到画面人物，场景，风格和光线的影响；导致我们修改人物动作或者处理场景氛围，视频效果总有一种拼贴感；现在我们只需要先把视频转成深度视频，它只负责只参考其中的人物站位、肢体动作、脚步节奏、镜头运动、画面构图和空间纵深；再通过角色和场景图和小梦的S,D2️⃣.5️⃣控制风格和光影氛围，这样出来的视频更干净更灵活；
#AI视频  #深度视频  #动作迁移  #视频转绘  #ai关键词  #AI新手村   #howto用好AI #aigc #Al进化生活howto #howto邪修出片

- 出处：https://www.douyin.com/video/7669779308189175046
- 平台 / 作者：抖音 · AIGC 作业本
- 发布时间：2026-08-03T12:21:05.000Z
- 提到的框架/工具：aigc、howto

> 用AI深度视频做动作迁新玩法｜更稳更灵活 以前我们做AI视频，经常会受到画面人物，场景，风格和光线的影响；导致我们修改人物动作或者处理场景氛围，视频效果总有一种拼贴感；现在我们只需要先把视频转成深度视频，它只负责只参考其中的人物站位、肢体动作、脚步节奏、镜头运动、画面构图和空间纵深；再通过角色和场景图和小梦的S,D2️⃣.5️⃣控制风格和光影氛围，这样出来的视频更干净更灵活； #AI视频 #深度视频 #动作迁移 #视频转绘 #ai关键词 #AI新手村 #howto用好AI #aigc #Al进化生活howto #howto邪修出片

### 一个免费的、能给你的3D模型添加各种动作的实用网站。支持2000+ 3D动作，可以自动完成3D模型的骨骼绑定。如果不知道如何生成3D模型，可以看往期视频。之前分享过很多期AI 3D建模工具，一张图，就能快速转成3D模型。#3D动画  #3D建模  #游戏开发  #AI3D  #AI工具测评

- 出处：https://www.douyin.com/video/7664235508343508259
- 平台 / 作者：抖音 · X小鹿同学
- 发布时间：2026-07-19T13:48:17.000Z
- 提到的框架/工具：AI3D

> 一个免费的、能给你的3D模型添加各种动作的实用网站。支持2000+ 3D动作，可以自动完成3D模型的骨骼绑定。如果不知道如何生成3D模型，可以看往期视频。之前分享过很多期AI 3D建模工具，一张图，就能快速转成3D模型。#3D动画 #3D建模 #游戏开发 #AI3D #AI工具测评

### AI视频动作一致性解决方法，深度视频AI动作迁移实测！ #AI视频 #ai工具 #AI #人工智能 #提示词

- 出处：https://www.douyin.com/video/7672314350287260962
- 平台 / 作者：抖音 · 千雪AI
- 发布时间：2026-08-10T08:18:14.000Z
- 提到的框架/工具：（无）

> AI视频动作一致性解决方法，深度视频AI动作迁移实测！ #AI视频 #ai工具 #AI #人工智能 #提示词

### 【Seedance 2.0 + Blender】主角动作迁移 本期教你用 Blender 预设动作 + Seedance 2.0 实现角色动作迁移，为AI视频动作不稳定、反复抽卡的问题提供一种新思路。

教程步骤：

1. Blender 搭建3D假人模型 + 骨骼绑定与动作设计
2. 渲染输出标准动作参考视频
3. Seedance 2.0 导入视频与角色图，一键生成动画

用这套工作流，大幅提升动作一致性，减少无效生成，做动画效率直接拉满～

#ai新星计划 #科技下一站 #与ai同行 #rhtv #runninghub

- 出处：https://www.douyin.com/video/7630838537377832335
- 平台 / 作者：抖音 · 电磁波Studio
- 发布时间：2026-04-20T13:50:50.000Z
- 提到的框架/工具：Blender、rhtv、runninghub、Seedance、Seedance 2.0

> 【Seedance 2.0 + Blender】主角动作迁移 本期教你用 Blender 预设动作 + Seedance 2.0 实现角色动作迁移，为AI视频动作不稳定、反复抽卡的问题提供一种新思路。 教程步骤： 1. Blender 搭建3D假人模型 + 骨骼绑定与动作设计 2. 渲染输出标准动作参考视频 3. Seedance 2.0 导入视频与角色图，一键生成动画 用这套工作流，大幅提升动作一致性，减少无效生成，做动画效率直接拉满～ #ai新星计划 #科技下一站 #与ai同行 #rhtv #runninghub

### MiniMax H3动作迁移教程！零基础一键复刻人物动作 零基础玩转MiniMax H3动作迁移！教大家超实用的黑白预处理技巧，提前将动作参考视频去色、消除色彩干扰，完美解决AI生成模糊、画面崩坏问题。只需准备人物图+动作视频，简单上传、输入提示词，就能1:1复刻人物肢体动作，全程无复杂配置，新手也能轻松上手！分享实操避坑要点，做AI短剧、人物动画必备技巧。
#MiniMaxH3  #MiniMaxH3教程  #AI动作迁移  #AI视频生成 #ComfyUI教程

- 出处：https://www.douyin.com/video/7677832078259539219
- 平台 / 作者：抖音 · 小枫 AI｜ComfyUI
- 发布时间：2026-08-25T05:09:50.000Z
- 提到的框架/工具：ComfyUI、MiniMaxH3

> MiniMax H3动作迁移教程！零基础一键复刻人物动作 零基础玩转MiniMax H3动作迁移！教大家超实用的黑白预处理技巧，提前将动作参考视频去色、消除色彩干扰，完美解决AI生成模糊、画面崩坏问题。只需准备人物图+动作视频，简单上传、输入提示词，就能1:1复刻人物肢体动作，全程无复杂配置，新手也能轻松上手！分享实操避坑要点，做AI短剧、人物动画必备技巧。 #MiniMaxH3 #MiniMaxH3教程 #AI动作迁移 #AI视频生成 #ComfyUI教程

## B站（20 条）

### 全网最强人物替换，动作迁移，MiniMaxH3还能这么玩？ComfyUI 工作流免费分享，详细教学！

- 出处：https://www.bilibili.com/video/BV1Tyto6mEXy
- 平台 / 作者：B站 · 啦啦啦的小黄瓜
- 发布时间：2026-09-03T11:09:36.000Z
- 提到的框架/工具：ComfyUI、MiniMaxH3

> 全网最强人物替换，动作迁移，MiniMaxH3还能这么玩？ComfyUI 工作流免费分享，详细教学！ 小助理联系方式：zhuli240614 ComfyUI节点详解网址：uinodes.com，网站使用教程： [ComfyUI]全网最详细节点测试以及参数详解，近千节点持续更新，纯干货教程总结梳理。 插件地址(包含工作流)：https://github.com/Songssx/ComfyUI-MiniMaxH3-TimelineDirector MiniMaxH3官方地址：https://huggingface.co/MiniMaxAI/MiniMax-H3 本期工作流以及素材链接：https:…

### 通过深度图depth map白模视频复刻视频动作视频动作迁移完美复制

- 出处：https://www.bilibili.com/video/BV12sbj6wEQ6
- 平台 / 作者：B站 · 鸡你太太太美v
- 发布时间：2026-09-05T12:51:49.000Z
- 提到的框架/工具：（无）

> 通过深度图depth map白模视频复刻视频动作视频动作迁移完美复制 Depth Anything V2视频深度图图片深度图转换白模视频白模图片转换WebUI 镜像使用地址： https://www.xiangongyun.com/image/detail/068d4f20-ea39-458d-a1da-05a15cc44399?r=WZFDHU minimax h3，sd2，sd2.5在线使用地址：https://wy6688.token6688.com/

### SCAIL2动作迁移测试

- 出处：https://www.bilibili.com/video/BV1rRbL6QEwu
- 平台 / 作者：B站 · 简单粗暴有的吃
- 发布时间：2026-09-05T13:49:10.000Z
- 提到的框架/工具：SCAIL2

> SCAIL2动作迁移测试 试了下SCAIL2，在动作迁移上总体比Animate好很多，无论是配置要求还是人物一致性上，Animate要想达到较好的效果需要做大量的调节和测试，SCAIL2则要简单很多，综合起来在动作迁移上SCAIL2完胜Animate

### 视频AI转骨骼动画

- 出处：https://www.bilibili.com/video/BV1UApAztEF2
- 平台 / 作者：B站 · 小熊教Maya
- 发布时间：2025-09-18T03:30:00.000Z
- 提到的框架/工具：（无）

> 视频AI转骨骼动画 3500个动画素材 ，想要的同学一键三连加关注，私信发1我，上线看到回复

### [测试]Minimax H3 Fun Controlnet与Scail2人物替换/动作迁移对比

- 出处：https://www.bilibili.com/video/BV1rzt26gEZz
- 平台 / 作者：B站 · 紫色土豆33
- 发布时间：2026-09-05T09:39:05.000Z
- 提到的框架/工具：ControlNet、Scail2

> [测试]Minimax H3 Fun Controlnet与Scail2人物替换/动作迁移对比

### 什么是动作的迁移性？

- 出处：https://www.bilibili.com/video/BV1WhALeUEFC
- 平台 / 作者：B站 · SFSW四方力量
- 发布时间：2025-02-16T11:16:07.000Z
- 提到的框架/工具：（无）

> 什么是动作的迁移性？ 对于简单力训动作直接迁移性的判断

### 实拍转AI动作迁移测试

- 出处：https://www.bilibili.com/video/BV1bTtP6wEzv
- 平台 / 作者：B站 · b13572044
- 发布时间：2026-08-28T08:39:50.000Z
- 提到的框架/工具：（无）

> 实拍转AI动作迁移测试 6月份的测试内容，存档

### ComfyUI 174集，长视频动作迁移，循环流程，FP8，GGUF，小显存专用。整合包，流程，免费下载，网盘在第一集视频说明。

- 出处：https://www.bilibili.com/video/BV1yAxJzVEA3
- 平台 / 作者：B站 · 程序员萝卜
- 发布时间：2025-10-06T13:16:36.000Z
- 提到的框架/工具：ComfyUI、ComfyUI 174

> ComfyUI 174集，长视频动作迁移，循环流程，FP8，GGUF，小显存专用。整合包，流程，免费下载，网盘在第一集视频说明。 萝卜全部资源\Kontext整合包\附加模型\171万相Animate

### 轻松搞定爆款复刻不是简单的动作迁移/场景替换

- 出处：https://www.bilibili.com/video/BV17L8M6FEyA
- 平台 / 作者：B站 · 灵动岛-AI农民工
- 发布时间：2026-08-21T06:12:01.000Z
- 提到的框架/工具：seedance2

> 轻松搞定爆款复刻不是简单的动作迁移/场景替换 轻松搞定爆款复刻 不是简单的动作迁移/场景替换 #seedance2#视频参考#ai电商#ai生成

### ComfyUI+MimicMotion生成单图骨骼动作引导视频

- 出处：https://www.bilibili.com/video/BV1Tf421z7ZV
- 平台 / 作者：B站 · 竹竹AI_
- 发布时间：2024-07-06T01:42:02.000Z
- 提到的框架/工具：ComfyUI

> ComfyUI+MimicMotion生成单图骨骼动作引导视频 工作流：https://zhuzhukeji.cn 专流专包：https://zhuzhukeji.cn/comfyui?name=comfyui_20240705 插件：https://github.com/kijai/ComfyUI-MimicMotionWrapper/tree/main

### 视频动作迁移。ai视频换脸。用手机就能制作

- 出处：https://www.bilibili.com/video/BV1Hi2CB6Emm
- 平台 / 作者：B站 · potatoAI
- 发布时间：2025-12-08T08:24:03.000Z
- 提到的框架/工具：（无）

> 视频动作迁移。ai视频换脸。用手机就能制作 评论区有制作教程

### Animate动作迁移V9版-多参考图版本发布

- 出处：https://www.bilibili.com/video/BV1fSEw6HE9X
- 平台 / 作者：B站 · 小珠光
- 发布时间：2026-06-04T17:06:30.000Z
- 提到的框架/工具：（无）

> Animate动作迁移V9版-多参考图版本发布 -

### MiniMax-H3 动作迁移真无限时长(全自动切分生成组合视频流)

- 出处：https://www.bilibili.com/video/BV1dYtm6AE6t
- 平台 / 作者：B站 · 哦西小盆友
- 发布时间：2026-09-05T08:05:52.000Z
- 提到的框架/工具：（无）

> MiniMax-H3 动作迁移真无限时长(全自动切分生成组合视频流) Minimax-H3工作流脚本，全自动视频切分逐段动作迁移，且全自动合并视频工作脚本 源码与整合包：https://pan.quark.cn/s/58b73c8a9c89 在此鸣谢： @机智罗_LX @刘悦的技术博客

### 【ComfyUIminimaxh3工作流】动作迁移低显存畅跑 For循环长视频生成 多人姿势迁移 360° 旋转 -

- 出处：https://www.bilibili.com/video/BV1TQhw6NEDQ
- 平台 / 作者：B站 · ComfyUI安装包
- 发布时间：2026-08-27T06:22:44.000Z
- 提到的框架/工具：ComfyUIminimaxh3

> 【ComfyUIminimaxh3工作流】动作迁移低显存畅跑 For循环长视频生成 多人姿势迁移 360° 旋转 - Up还有别的工作，不一定会秒回，但是看见了都会回复，谢谢！~[保卫萝卜_哇][保卫萝卜_哇]

### C4D R23动作映射功能 将动作传递给模型 角色定义骨骼绑定

- 出处：https://www.bilibili.com/video/BV1oU4y1c7xS
- 平台 / 作者：B站 · 满城兄dei
- 发布时间：2021-10-08T04:14:27.000Z
- 提到的框架/工具：（无）

> C4D R23动作映射功能 将动作传递给模型 角色定义骨骼绑定 教程里用到的素材以及骨骼名称中英文对照表可以在公众号（迷路小鸟）里回复GUGE，就能下载啦。

### 【教程】免费的视频提取动画工具-Plask

- 出处：https://www.bilibili.com/video/BV1Bq4y1k7tz
- 平台 / 作者：B站 · 渣成灰zch
- 发布时间：2022-01-19T14:49:22.000Z
- 提到的框架/工具：（无）

> 【教程】免费的视频提取动画工具-Plask 转自https://www.youtube.com/channel/UClHOCrckvQEcrkqH4A7PA5A/videos 文章介绍：https://80.lv/articles/plask-a-new-free-tool-for-extracting-3d-motion-from-videos

### 如何用AI工作流制作高清动作迁移、动作模仿视频

- 出处：https://www.bilibili.com/video/BV1CfbZzFEkC
- 平台 / 作者：B站 · 清木技术流
- 发布时间：2025-07-23T05:04:23.000Z
- 提到的框架/工具：（无）

> 如何用AI工作流制作高清动作迁移、动作模仿视频 如何用AI工作流制作高清动作迁移、动作模仿视频

### [MimicMotionWrapper] 动作迁移

- 出处：https://www.bilibili.com/video/BV11NXfBBEze
- 平台 / 作者：B站 · Iammyself001
- 发布时间：2026-04-02T07:22:00.000Z
- 提到的框架/工具：ComfyUI

> [MimicMotionWrapper] 动作迁移 https://github.com/kijai/ComfyUI-MimicMotionWrapper --------- 参考：https://www.bilibili.com/video/BV16JAfzsEck?vd_source=REDACTED-BILIBILI-TRACKING-TOKEN&amp;spm_id_from=333.788.player.switch&amp;p=55 ------------ 1.本研究中使用的部分肖像数据来源于互联网公开资源：https://www.math.pku.edu.

### 一分钟教会你使用视频ai工具，电脑手机工作流，人物替换，动作迁移，动作模仿，一键换装换背景

- 出处：https://www.bilibili.com/video/BV1XTKb6QE5w
- 平台 / 作者：B站 · 莎翁ai视频
- 发布时间：2026-07-21T08:54:57.000Z
- 提到的框架/工具：（无）

> 一分钟教会你使用视频ai工具，电脑手机工作流，人物替换，动作迁移，动作模仿，一键换装换背景 电脑端详细操作流程在往期作品

### Codex+即梦强强联合，精准的动作迁移。

- 出处：https://www.bilibili.com/video/BV1Ethw6DE2h
- 平台 / 作者：B站 · 像素诗人-公子慕辰
- 发布时间：2026-08-27T07:05:30.000Z
- 提到的框架/工具：即梦

> Codex+即梦强强联合，精准的动作迁移。

## 小红书（20 条）

### 深度视频动作迁移教程｜3步复刻人物动作

- 出处：https://www.xiaohongshu.com/explore/6a7c1247000000002203249d?xsec_token=YBNpS4j3RV6hp-MleZix_XGByT5hgUQq8YVddhAlAbZ00%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 伊娜AI实战笔记
- 发布时间：2026-08-12T06:27:19.000Z
- 提到的框架/工具：（无）

> 直接参考原视频，人物和风格总容易跑偏？先把原视频转成深度视频，再到jimeng 传深度视频和人物三视图，用SD25模型

### 零基础学AI视频动作迁移

- 出处：https://www.xiaohongshu.com/explore/6a82a5970000000033012cbb?xsec_token=YBR7M9I26_b5ynsYXyyVFZv4xZvhSVn8dV5686bj_v0u8%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 时光小邮差
- 发布时间：2026-08-17T06:09:27.000Z
- 提到的框架/工具：（无）

> 今天跟大家聊一个超酷的AI玩法—— 视频动作迁移 🕺 简单说就是：让视频A里的动作，"移植"到视频B的人身上。 比如把

### 清华：不同骨架能轻松转动作吗？

- 出处：https://www.xiaohongshu.com/explore/68a69b83000000001d01ccd4?xsec_token=YBynGOAIIHJ-4FkTCBH7_MLLkA-JNQgVeFdLppsEmAi9w%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 学术GPT
- 发布时间：2025-08-21T04:07:31.000Z
- 提到的框架/工具：（无）

> ❓Motion2Motion 是什么？ Motion2Motion 是一个全新的、无需训练的动画迁移框架，专为解决不同骨

### 一段深度视频，AI就能精准复刻所有动作

- 出处：https://www.xiaohongshu.com/explore/6a97eac90000000026008a25?xsec_token=YBzqIO9p8Twey0jXW3UAUwBzYkHhsHfbCiM6d5T5euMGo%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 刘量AI
- 发布时间：2026-09-02T10:03:35.000Z
- 提到的框架/工具：（无）

> #AI视频 #深度视频 #动作迁移 #动作复刻 #AI #AI工具 #AI电影

### 视频动作迁移

- 出处：https://www.xiaohongshu.com/explore/6a86ee2f00000000330319ab?xsec_token=YB9XQCTL-70NKAf5JbTMmZ7g4sQs59PLf1SPOn7EcgtfE%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 左眼设计（AIGC）
- 发布时间：2026-08-20T12:08:15.000Z
- 提到的框架/工具：comfyui、ComfyUI

> #comfyui #动作迁移

### 如何用 Codex 实现视频动作迁移？

- 出处：https://www.xiaohongshu.com/explore/6a8860960000000023013a38?xsec_token=YBGzt_k58IATvpt68Q_cvltmC0Rr49zt2LG3DgH6l1nnA%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · nana娜娜呀
- 发布时间：2026-08-21T14:28:38.000Z
- 提到的框架/工具：codex、howto

> #codex #AI进化生活howto #howto解锁创意剪辑 #howto玩坏AI #AI #AI新手村

### 只需一段深度参考，AI就能还原整套动作

- 出处：https://www.xiaohongshu.com/explore/6a99338d000000002b01d85c?xsec_token=YB03YCD1bIKM4LVpH-UKv5RJU8PsmGT-bDcLe8Vf3RA1w%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 夏天Amo
- 发布时间：2026-09-03T10:00:22.000Z
- 提到的框架/工具：（无）

> 同一段舞蹈，也能直接换成自己的角色和场景，动作、走位、节奏和运镜基本不变。只需要提取深度动作参考，再搭配人物图和场景图生

### ComfyUI实战:SCAIL2 无限时长 单人动作迁移

- 出处：https://www.xiaohongshu.com/explore/6a68ecb2000000000101fe06?xsec_token=YB2q9svf97QJ-7px5P1kpJJK86EFI8diF60BXcW1fMpb0%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 品卓AI
- 发布时间：2026-07-28T17:53:54.000Z
- 提到的框架/工具：ComfyUI、SCAIL2

> 基于SCAIL-2开源模型，支持分钟级视频动作精准复刻（已验证），理论上支持无限时长，实际取决于硬件条件，工作流已分享到

### 一键复刻经典舞蹈🔥AI 动作迁移太绝了✨

- 出处：https://www.xiaohongshu.com/explore/6a8f187a000000000502bfe3?xsec_token=YBw9cazhwnOgfiHBlA0Zn5FnabIZm53QAszMnn3f6RqmE%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 寒松映雪
- 发布时间：2026-08-27T04:25:02.000Z
- 提到的框架/工具：（无）

> 想复刻热门经典舞蹈，但不想自己出镜跳舞？💃 AI 动作迁移直接搞定！ 左边原始舞蹈素材，右边 AI 复刻完成的舞蹈视频

### 动作模仿全攻略！！一次讲透玩法与细节！

- 出处：https://www.xiaohongshu.com/explore/697c84c8000000000a0306f4?xsec_token=YBgXPlKvBsAEfE_vJ_iIbpxPxQ8TrxoCMUkLqmsct0-mU%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 居鲁仕
- 发布时间：2026-01-30T12:36:20.000Z
- 提到的框架/工具：（无）

> 最近收到很多大家的反馈，大多都是一些细节问题，这条视频帮助大家再整体梳理一下，希望你能做出自己满意的效果，有什么问题欢迎

### AI控图新技巧🔥用深度图精准实现动作迁移

- 出处：https://www.xiaohongshu.com/explore/6a872ab7000000001d01c3a9?xsec_token=YBbbkWXFawKvagFSK_YFUtE7FmoABN6lGz6URbByeven0%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · Sherry
- 发布时间：2026-08-20T16:26:31.000Z
- 提到的框架/工具：（无）

> 想要做动作迁移，用深度视频就可以搞定，人物、场景还有画风都能替换得很到位，整套操作上手门槛很低，而且操作流程并不复杂，今

### SCAIL实测+工作流分享-动作迁移新模型

- 出处：https://www.xiaohongshu.com/explore/6940427c000000001e01778a?xsec_token=YBYKpbeskjxMH5H3X-y_0p0DW_Qwp4C1dyse4l_F3b8UY%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 李嗯Liamm
- 发布时间：2025-12-15T17:16:44.000Z
- 提到的框架/工具：（无）

> 让AI帮我跳街舞，结果感觉自己成了痴傻儿😂 但动作是真的丝滑

### 完美视频动作迁移工作流

- 出处：https://www.xiaohongshu.com/explore/6866b2ab000000001203c6ae?xsec_token=YBNjqbzJ5G-fvvWnfLbU0dB0nEDKWHcOTMvuO0yuls6RU%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 五彦祖
- 发布时间：2025-07-03T16:41:15.000Z
- 提到的框架/工具：（无）

> liblib在线已经跑通。直接用就可以。有详细说明。 liblib直接搜我名称:五彦祖，点击我的头像进到主页工作流页面可

### 如何用Codex迁移任何人物动作？

- 出处：https://www.xiaohongshu.com/explore/6a8ac5360000000017003a88?xsec_token=YBb3kgRdR4yKBcukCdaYm1x_JAUSxlhbbqbhZmgCx-mXM%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 啤酒的种草AI
- 发布时间：2026-08-23T10:02:30.000Z
- 提到的框架/工具：（无）

> 主要是用codex+jimeng这两个东西做的，过程非常简单，感兴趣的可以玩起来！#好视频扶持计划 #AI进化生活ho

### MoCapAnything V2

- 出处：https://www.xiaohongshu.com/explore/69f4202f000000001f002159?xsec_token=YBMi2A-45qtzmqkddC4OuhFVFVtMWvFv0cdqKw_hEPZS4%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · Elysia
- 发布时间：2026-05-01T03:38:23.000Z
- 提到的框架/工具：（无）

> 🎥 视频 → 骨架 → 旋转，全流程端到端 ⚓ 引入参考姿态作为“坐标锚点”，解决 pose→rotation 的本质

### 失败3次，总结出7个完美实现动作迁移技巧

- 出处：https://www.xiaohongshu.com/explore/6986fe14000000001503aaf9?xsec_token=YB3kvchiffjr4ejnSnXYqnmoDi0K28rbM8Fi2sPx5TjpI%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 何止维
- 发布时间：2026-02-07T10:01:28.000Z
- 提到的框架/工具：可灵

> #AI工具 #AI生成 #动作迁移 #干货 #工作流 #可灵

### wan2.2模型，最便捷的视频动作迁移工作流#wan #comfyui #动作迁移 #ai视频 #ai视频教程

- 出处：https://www.xiaohongshu.com/explore/69c35439000000002800a41c?xsec_token=YBV8Z9eET-h4jJ9GFkRj_kZDKHWmvojKw5gzgS13fJf0g%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 会画画的猿猿酱
- 发布时间：2026-03-25T11:02:24.000Z
- 提到的框架/工具：comfyui、ComfyUI、wan、Wan

> wan2.2模型，最便捷的视频动作迁移工作流#wan #comfyui #动作迁移 #ai视频 #ai视频教程

### SCAIL pose更新 多人姿态完美迁移

- 出处：https://www.xiaohongshu.com/explore/69428cea000000001e02100c?xsec_token=YBBn8kWV_3lhkNuZqwwx7hEkHUmBMD6pU1826BEEJovCA%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 山丘起伏
- 发布时间：2025-12-17T10:58:50.000Z
- 提到的框架/工具：comfyui、ComfyUI、SCAIL

> 昨天还说三人姿态有问题，今天就看到节点更新了😀 #comfyui #没有一个动作是多余的 #动作 #SCAIL

### SCAIL-2 太强了！角色替换、动作与表情迁移

- 出处：https://www.xiaohongshu.com/explore/6a2a3c34000000002200ba08?xsec_token=YByB1h06Frqxbi5liWBekaSRL4o9M3LrX0lp4tE_ks6rk%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 我不吃番茄（禁言丝番茄哥）
- 发布时间：2026-06-11T04:40:20.000Z
- 提到的框架/工具：（无）

> SCAIL-2 是一款强大的角色动画与人物替换模型，能够根据驱动视频，将动作、表情和角色身份迁移到参考人物中。 本期视频

### ComfyUI实战: SCAIL-2 双人动作迁移

- 出处：https://www.xiaohongshu.com/explore/6a6a1011000000001d00d43d?xsec_token=YBSyNw0-Oo29NK8jpv1tcOlxNLkaNYAFgHfDvDQDk-HPk%3D&xsec_source=pc_search
- 平台 / 作者：小红书 · 品卓AI
- 发布时间：2026-07-29T14:37:05.000Z
- 提到的框架/工具：ComfyUI

> 基于SCAIL-2开源模型，支持分钟级视频动作精准复刻（已验证），理论上支持无限时长，实际取决于硬件条件，工作流已分享到

