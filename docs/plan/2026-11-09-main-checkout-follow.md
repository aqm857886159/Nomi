# 主仓自动跟上 main

## 变更意图
- 意图：纯修复
- 候选档位：短
- 单一意图：是
- 声明：纯修复：不改用户可见元素、布局、文案
- 界面核实：无界面差异（只改开发会话钩子，无拍板图变动）

## 短版设计卡
- ★1：会话开场时让干净主仓 main 快进，避免长期使用过期钩子；量具为 scripts/main-checkout-follow.node-test.mjs 的临时真实 Git 远端/克隆，另有主仓修前 HEAD、修后 HEAD 与两轮真实钩子日志；不碰用户项目和已编辑文件，老用户数据不适用。
- ★2：Git 是 checkout/branch/index 唯一 owner；SessionStart 的 handoff-read.sh 调统一入口；只对 Git 主工作区生效，worktree 不参与；机器级雷达状态已由 intake 缓存 owner 管理。数门：door-map 不支持 .sh，shell 入口另用 rg 核对；runSession --roots=scripts 输出见任务报告。
- ★3：任务书明确选删除过时主仓改动并自动跟进；旧 handoff-read 只读交接卡，安装器只验版本化注册，不负责更新；三路为继续手动拉取、改用户启动方式、在现有 SessionStart 前执行 Git 快进，选最后一条复用已有事件、Git 锁和 ff-only；每日雷达已在 98f842d2a 修为仓库外写入，本次不重复改。
- ★4：工作树/未配置仓库无动作；成功提示新 HEAD；脏/非 main/分叉/锁冲突提示缓存落后数与阻挡文件；离线提示并退出 0；不安装依赖，锁文件有差提示「主仓依赖要装」；取消由 Git 超时结束，无持久任务和重试；不存在 UI 状态。
- ★9：验收清单及反例在实现前固定：干净落后→HEAD 等于远端；脏（tracked/untracked）→HEAD 和内容不变且提示文件；非 main→HEAD/分支不变且提示；离线→退出 0 且提示；linked worktree→主仓和 worktree 均不动；分叉→保持 HEAD 不变提示 ff；锁文件改变→只提示依赖安装且不安装；已有 index.lock→不删除锁、退出 0；通过 SessionStart 真实命令验证接线。四个主反例各改坏判断后测试红，恢复后绿。回滚为 revert 本线实现提交；人工 B 操作的原 HEAD 和 binary patch 留在指定 tmp。独立验收由协调另派，本线不派 agent、不推送、不建 PR。

## 根因与范围
- 症状：会话使用主仓过期钩子，提醒与门岗规则长期漂移。
- 直接原因：主仓停留在旧 HEAD；三个跟踪改动挡住更新。
- 类根因：开场没有检查并维护主仓版本的不变量，脏状态也无醒目反馈。
- 边界：只在主工作区根目录、main、完整工作区干净、origin/main 可 ff 时改 Git；再次检查分支与工作区防并发变化，失败退出 0，Git 自己管理锁。
- 影响范围：handoff-read.sh、一个无依赖 Node 脚本、真实 Git 夹具测试、根因合同、现有 check:claude-hooks 测试命令；注册和其它钩子保持既有链路。
- 写入点审计：scripts/model-radar.ts 的 RESULT_DIR 写 intake 缓存/model-radar；writeSnapshot 仅 --update-baseline，需人确认；handoff-write 写 .claude/handoff，工程数缓存写被忽略的 .claude/eng-metrics-cache.json，self-check 写被忽略的命中日志；这些不产生跟踪改动。主仓三个未跟踪旧产物不得删除，仍会被自动跟进的脏检查明确报出。
