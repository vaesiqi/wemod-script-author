# WeMod 自动化脚本作者 · 技能包

> 把一句需求写成**可直接导入运行**的自动化脚本 JSON。本技能包**自包含、零源码依赖**——没有项目源码也能写脚本、跑离线校验、产出可用交付物。
>
> Language: [中文](README.md) | [English](README.en.md)
>
> 许可：[MIT](LICENSE)

## 这是什么

一套面向 AI 助手（Reasonix / Claude Code 等支持 `SKILL.md` 的工具）的**技能包**，蒸馏自 WeMod 安卓自动化项目的三大引擎真实实现（字段名 / 枚举 / 语义已**全部内嵌**进 `SKILL.md`，不是链接到源码）：

| 引擎 | 覆盖 |
|---|---|
| 动作模型 | 19 种节点、全部动作类型（含按键注入、Shell 命令、截屏、AI 视觉 / 回复 / 代理）、ActionConfig、条件模型、NodeSelector、虚拟控件、枚举全集 |
| 变量引擎 | 变量作用域、表达式语法与 100+ 内置函数、字段解析规则 |
| 执行引擎 | 生命周期、控制流语义、软 / 硬失败、运行需求、事件、JS API |

字段名 / 枚举值与源码逐一核对过；`.axs` 导入走严格 JSON 的坑（如 `consoleVariables[].defaultValue` 必须是字符串）已内建到校验工具。

## 三种用法

1. **作为 AI 技能（推荐）**：把整个目录放进你的技能目录（Reasonix 为 `.reasonix/skills/wemod-script-author/`），然后对助手说"用 wemod-script-author 写一个……"；
2. **作为手册**：直接读 `SKILL.md`（§0 边界 / §3 动作表 / §4 变量 / §7 自查清单），人工编写脚本；
3. **只用校验器**：`node tools/validate-script.mjs 你的脚本.axs` 做离线预检。

## 目录结构

```
wemod-script-author/
├── SKILL.md                    # 主技能：五步交付流程 + 完整模型手册 + 自查清单（自包含）
├── examples/                   # 可导入的完整样例（每个都必须能用下面的校验器跑通）
│   ├── auto-douyin-skin-001.axs       # 肤色判定点赞收藏：视觉条件 + jumpTargetOnFail
│   ├── auto-quiz-answer-001.axs       # 自动答题：subflow_def 子流程复用
│   ├── vision-loop-retry-001.axs      # 图色识别循环重试：wait_for_vision + outputs 写变量 + events.onTimeout 回跳标签
│   ├── branch-conditions-001.axs      # 条件分支与循环：if + 条件组（ALL / N_OF）+ var_switch + while_var + while_vision
│   ├── notification-trigger-001.axs   # 通知触发：收到指定内容通知时执行子流程
│   ├── variables-batch-items-001.axs  # 变量批量操作：1 个节点 + items 一次定义/自增/拷贝多个变量（条目可混 set/inc/get）
│   ├── color-multi-point-001.axs      # 多点比色 / 多点找色：color_at.points 与 color_region（FIND_TARGETS + points + findDirection）→ 命中点写变量再点击
│   └── window-trigger-001.axs         # 窗口触发：指定窗口出现时执行
└── tools/
    └── validate-script.mjs      # 离线校验器（node 运行，不依赖 Android / 源码）
```

## 快速开始

```bash
# 1) 自检技能包（应输出"校验通过"）
node tools/validate-script.mjs examples/auto-douyin-skin-001.axs

# 2) 校验你自己的脚本
node tools/validate-script.mjs 你的脚本.axs
#    检查项：JSON 语法 / 必填字段 / 枚举值 / 引用完整性 / consoleVariables 类型 / 作者归属

# 3) 上手机
#    脚本本体就是 JSON：改后缀为 .axs，用文件管理器打开（或在 App 内导入）→ 完整导入，保留控制台变量 / 设置 / 虚拟控件。
#    注意：编辑器里的「粘贴 JSON」只插节点、不带顶层设置，完整导入必须走 .axs。

# 4) 要发布到脚本库（社区）？
#    脚本必须有「作者归属」：在顶层 publishMeta.community_author_user_id 填你自己的社区用户 ID（数字）。
#    导入的脚本没有归属时，脚本列表里不会出现「发布到社区」入口；此时可在 App「脚本详情 → 作者 → 声明我是作者」补上。
#    详见 SKILL.md §2.3（含"如何查自己的 uid"与取值纪律）。

# 5) 写脚本时的写法规范（技能正文会自动引导）：
#    · 同一处的多个变量必须合并成一个节点 + items（set_var / inc_var / get_var 都支持，条目可混 set/inc/get），
#      不要堆一排 set_var；宿主 key/value 留空串占位即可（"key":"", "value":""）。
#      范例：examples/variables-batch-items-001.axs，说明：SKILL.md §4.3。
#    · 校验器会对「同一处连续 ≥3 个变量节点」给出 ℹ 提示（可合并），不阻断、不计入警告数。
#    · 多点比色 / 多点找色：采样点是 ColorAtPoint（dx/dy 像素偏移，或 dxPct/dyPct **相对锚点**的百分比偏移，
#      未设置写哨兵 -2）；比色用 color_at.points + pointsMatchMode + requiredMatchCount，
#      找色必须在 color_region 上写 matchMode="FIND_TARGETS" 再给 points + pointsMatchMode + pointsRequiredMatchCount
#      （默认 REGION_MATCH 时 points 不生效）；命中点走 outputs.pointVar，可直接给 tap 的 pointVarKey。
#      范例：examples/color-multi-point-001.axs，说明：SKILL.md §3.5.1。
#    · 变量解析失败 = 软失败（不再回退字面量）：参数类字段（坐标/时长/次数/间隔/超时/文本内容/链接/路径/虚拟控件）
#      的 *VarKey 非空时，变量未定义 / 值为 null 或空白串 / 表达式求值失败 ⇒ 动作按失败处理（走 onFail / 重试策略，
#      运行日志写明「字段名 + 变量名 + 原因」）；唯一例外：值类型不可转（如文本当坐标）→ 警告后回落。
#      条件类（视觉条件的颜色/文字/模板/区域变量、条件组重试）不中断流程，但同样写日志。
#      ⇒ 请在动作执行之前给变量赋值，不要依赖「没准备好就用默认值」的旧行为。
```

## 版本与模型基准

- 数据基准：模型快照 **2026-09-28**（含 Shell 命令、按键注入、截屏保存位置等本轮新增；校准内容见 `SKILL.md` 顶部说明）。
- 若你手机上的 App 版本与技能包版本不一致：**先导入一个样例脚本实测**；不一致时**以 App 内的模型为准**。
- 维护者流程：改完 `SKILL.md` 后跑一遍 `node tools/validate-script.mjs examples/*.axs`，全绿再提交。

## 维护者：从项目同步

本仓库是 WeMod 项目内技能包的**对外发布版**（差异：按发布口径移除抢票 / 抢单三个样例）。项目侧改了 `SKILL.md` 或校验器后，在**本仓库**执行：

```bash
node tools/sync-from-project.mjs                 # 默认从 D:/wemod/wemod/.reasonix/skills/wemod-script-author 同步
node tools/sync-from-project.mjs --dry-run       # 只看会改什么，不写文件
node tools/sync-from-project.mjs --project <dir> # 指定其它项目技能包路径
```

脚本行为：

- **会覆盖** `SKILL.md`、`tools/validate-script.mjs`，并镜像 `examples/*.axs`（自动排除抢票 / 抢单样例）；
- 开源侧多余样例**只提示、不自动删除**；
- 同步后自检**对外文档是否引用了被排除的样例**（悬空引用会直接非 0 退出），再跑一遍全部样例校验；
- **不会触碰** `README*`、`LICENSE`、`.gitignore`、`.github/`（这些是本仓库专属内容）。

## 贡献

欢迎提 Issue / PR：补字段、修正语义、新增样例（**新样例必须能被 `tools/validate-script.mjs` 跑通**）。

## 免责声明

本技能包只提供"如何编写自动化脚本"的知识与工具。使用者应自行确保脚本用途**符合目标平台的服务条款与所在地法律法规**；因使用本技能包产生的任何后果由使用者自行承担。

## 许可

[MIT](LICENSE)