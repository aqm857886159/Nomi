# Nomi 跨设备继续创作：近邻产品交互取样

日期：2026-09-02
目的：为“在另一台电脑继续编辑”重新确定界面形态；只借鉴成熟产品的交互机制，不复制其品牌视觉。

## 结论

第一版不做独立的“同步中心”大面板，也不在项目库常驻展示设置说明。把它拆成三个就近动作：

1. 项目卡片只显示一个轻量状态（图标 + 2~4 字），让用户知道“现在能不能继续”。
2. 点击状态才打开一个紧凑 popover，只提供当前下一步（查看位置、重新检查、处理冲突）。
3. 同步目录/配置迁移属于一次性设置，放在现有设置的文件位置区域；不和模型、AI 策略混排。

这样符合 Nomi 的 density over decoration、local-first visibility 和“一功能一个家”：项目库负责“打开项目”，设置负责“改变位置”，异常才出现处理面板。

## 取样到的成熟机制

### DaVinci Resolve / Blackmagic Cloud

- Project Manager 以 Local / Network / Cloud 分层，用户先选项目库，再选项目；项目媒体位置在创建项目时单独设置。
- 云项目页把“项目库信息、分享、备份”分成右侧信息页，而不是在每个项目卡片里重复解释。
- 备份恢复是异常/维护动作，显示进度和恢复结果，不伪装成日常编辑步骤。

来源：

- https://help.cloud.blackmagicdesign.com/project-server/creating-a-cloud-project-in-davinci-resolve/
- https://help.cloud.blackmagicdesign.com/project-server/managing-project-libraries/

### Adobe Premiere Productions

- Production panel 是项目文件/文件夹的“命令中心”，项目本身保持普通 `.prproj` 文件，可以独立打开。
- 跨平台第一次打开时只要求确认 scratch disk，不要求用户理解一套新的云端项目模型。
- 文件锁/项目状态用非常轻的图标表达；需要处理时才进入对应项目或面板。

来源：

- https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-productions/productions-faq.html
- https://helpx.adobe.com/sg/premiere/desktop/collaborate-with-others/collaborate-using-productions/about-productions.html

### Dropbox Desktop

- 文件/文件夹旁用单一图标表达 synced、syncing、error、ignored；账户级详细状态在系统托盘窗口查看。
- 正常状态文案是“Your files are up to date”，异常才出现“See issues”等下一步。
- 图标负责扫描，详情负责解决；没有把所有状态说明平铺在主文件列表。

来源：

- https://help.dropbox.com/en-us/sync/sync-icons-windows
- https://help.dropbox.com/sync/check-sync-status

### Figma Offline

- 离线编辑仍然写入本地；恢复联网后通过一条通知提示“已同步”，冲突时给 Review 入口进入版本历史。
- 冲突不作为常驻表单，而是事件触发的通知/审阅动作；恢复旧版本也是独立的版本历史操作。

来源：

- https://help.figma.com/hc/en-us/articles/360040328553-What-can-I-do-offline-in-Figma

### 微力同步 / 坚果云

- 微力同步把“同步任务”理解为一个目录对目录的持续关系，支持选择性同步、暂停和冲突文件保留。
- 坚果云的多设备路径是：每台电脑安装客户端，选择本地同步目录；应用本身不应重复实现一个网盘客户端。
- WebDAV 更适合作为高级连接方式；不能让普通用户在项目库里填写 URL、账号和应用密码。

来源：

- https://www.verysync.com/
- https://help.jianguoyun.com/?p=24
- https://help.jianguoyun.com/?tag=webdav

## 套回 Nomi 设计系统

| 取样机制 | Nomi 采用 | Nomi 不采用 |
|---|---|---|
| 项目邻近状态 | 项目卡片底部一行状态，复用 `StatusBadge` / Tabler 图标 | 不再放双栏说明面板 |
| 详情按需出现 | 点击状态打开 popover，只有一个主动作 | 不常驻“第 1/2/3 步”教学 |
| 异常优先 | 正常只显示“已同步”；外部变化/缺少素材时显示下一步 | 不用大红 banner 覆盖整个页面 |
| 设置归位 | 文件位置、配置迁移放设置的文件位置区 | 不放进模型设置或 AI 策略 |
| 目录职责 | Nomi 只识别项目根目录与状态；VerySync/坚果云负责传输 | 不在 Nomi 内自研网盘协议 |

## 推荐样张的验收点

- 首屏只增加一行轻状态，不改变项目卡片的主动作和缩略图层级。
- 正常状态没有说明文字堆叠；用户点击状态后 1 次即可到“打开文件夹 / 重新检查 / 查看冲突”。
- 换机任务只需要：安装同步客户端 → 选同一目录 → 在 Nomi 打开项目；Nomi 只在缺目录或外部变化时提醒。
- 只有异常状态才出现第二层内容，且文案必须包含下一步，不出现“请阅读说明”。
