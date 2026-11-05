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
2. **作为手册**：直接读 `SKILL.md`（§0 边界 / §3 动作表 / §4 变量 / §6 H5 / §8 自查清单），人工编写脚本；
3. **只用校验器**：`node tools/validate-script.mjs 你的脚本.axs` 做离线预检。

## 目录结构

```
wemod-script-author/
├── SKILL.md                    # 主技能：五步交付流程 + 完整模型手册 + 自查清单（自包含；§6 为 H5：runGate / window.wemod / runtime.h5）
├── examples/                   # 可导入的完整样例（每个都必须能用下面的校验器跑通）
│   ├── auto-douyin-skin-001.axs       # 肤色判定点赞收藏：视觉条件 + jumpTargetOnFail
│   ├── auto-quiz-answer-001.axs       # 自动答题：subflow_def 子流程复用
│   ├── vision-loop-retry-001.axs      # 图色识别循环重试：wait_for_vision + outputs 写变量 + events.onTimeout 回跳标签
│   ├── branch-conditions-001.axs      # 条件分支与循环：if + 条件组（ALL / N_OF）+ var_switch + while_var + while_vision
│   ├── notification-trigger-001.axs   # 通知触发：收到指定内容通知时执行子流程
│   ├── variables-batch-items-001.axs  # 变量批量操作：1 个节点 + items 一次定义/自增/拷贝多个变量（条目可混 set/inc/get）
│   ├── data-quiz-foreach-001.axs      # 数据驱动 + 遍历循环：file_action(parseMode=LINES) 按行读题库 → foreach 逐题取题干/答案 → 命中点答案并 break
│   ├── data-quiz-multi-001.axs        # 多选题：答案列 # 分隔 → lines(replace(...)) 拆成选项数组 → foreach 逐个点选（单选/空答案天然正确）
│   ├── color-multi-point-001.axs      # 多点比色 / 多点找色：color_at.points 与 color_region（FIND_TARGETS + points + findDirection）→ 命中点写变量再点击
│   ├── window-trigger-001.axs         # 窗口触发：指定窗口出现时执行
│   ├── h5-gate-menu-001.axsp           # H5 运行前菜单（项目包）：runGate → ui/menu.html，读手机尺寸换算、条件字段显隐、参数写变量
│   ├── h5-events-panel-001.axsp        # H5 运行期事件面板（项目包）：runtime.h5.open → emit → 页面 on/emit → wait → close
│   ├── elevator-inspection-fill-h5-001.axsp  # 电梯定检填表（实填·H5 菜单版，项目包）：完整业务项目
│   ├── h5-wizard-001.axsp              # 多步骤向导（项目包）：3 步表单（基本参数 → 选项 → 汇总确认）+ 步骤条，第 3 步 wemod.start(values)
│   ├── h5-form-confirm-001.axsp        # 表单校验 + 二次确认（项目包）：必填/非法值内联红字 + 页面内确认层，确认后才 start
│   ├── h5-multi-select-001.axsp        # 列表多选写数组变量（项目包）：8 项复选 + 全选/反选 + 已选计数 → 选中项: ["A","B"] → 脚本遍历数组
│   └── h5-progress-panel-001.axsp      # 运行期进度面板（项目包）：无 runGate，脚本 open → 3 段 emit(progress) → wait(done) → close
└── tools/
    ├── validate-script.mjs      # 离线校验器（node 运行，不依赖 Android / 源码）
    └── validate-axsp.mjs        # .axsp 项目包校验器（zip 内 project.json / runGate.path / main.axs，复用 validate-script）
```

## 快速开始

```bash
# 1) 自检技能包（应输出"校验通过"）
node tools/validate-script.mjs examples/auto-douyin-skin-001.axs

# 2) 校验你自己的脚本
node tools/validate-script.mjs 你的脚本.axs

# 2b) 校验 H5 项目包（.axsp，含 runGate 与 ui/*.html）
node tools/validate-axsp.mjs
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

# 6) 写 H5 运行前菜单 / 运行期面板？
#    菜单 = 项目级 project.json → runGate（kind 目前只有 h5、path 项目内相对路径且区分大小写、
#           widthDp/heightDp 初始尺寸、title 非空=宿主画可拖动标题栏 / 空=页面自己画、
#           snapAfterStart 如 "left:28"、keepOnScriptEnd=true 保留到关控制台）；与 .ui.json 参数页互斥，H5 优先。
#           页面侧 API 是 window.wemod：start(values)/cancel()/rerun(values)、getVar/vars/setVar/onVarChange、
#           窗口方法、emit/on、onBack、close/log/toast。
#    面板 = 脚本 run_code 里 runtime.h5.open(path, 宽dp=300, 高dp=420, 标题)：失败返回空串 ''（必须判断）、
#           emit 推事件（页面未就绪排队 32 条、丢最旧，加载后补投）、wait 收事件（返回页面 payload 的 JSON 文本；
#           超时 / 页面关闭 / 停止脚本返回 null，必须判断）、close/closeAll 收尾。
#    可直接照抄 SKILL.md §6.2（菜单页完整 HTML）/ §6.6（open/emit/wait/close 完整代码）/ §6.7（事件面板 HTML）；
#    内置示例项目：sample_project_h5_gate（运行前菜单）、sample_project_h5_events（运行期事件面板）。
```

## H5 速记（详见 `SKILL.md` §6）

- **两个面**：运行前菜单（项目级 `project.json → runGate`）与运行期页面（脚本 `runtime.h5.*`）；页面侧 API 同一个 `window.wemod`（页面加载后注入，可监听 `wemod:ready`）。
- **窗口尺寸优先级**：`<meta name="wemod-size" content="宽x高">` → `runGate.widthDp/heightDp` → 运行中 `wemod.setSize` → 用户拖拽/缩放（不写回项目）→ 屏幕+系统栏夹取；**CSS 宽高改不了窗口**。
- **`wemod.screen()`** 字段：`widthPx/heightPx`、`widthDp/heightDp`、`density`、`densityDpi`、`safeTopPx`、`safeBottomPx`、`availableWidthPx`、`availableHeightPx`、`windowWidthPx`、`windowHeightPx`、`orientation`（`portrait` / `landscape`）。
- **运行控制**：`wemod.start(values)`（运行前菜单放行；门已完成后再点 = 按最新参数再跑一次）、`wemod.stop()`（停止当前运行，只停脚本不关页面）、`wemod.pause()/resume()`、`wemod.runState()`；控制台停止后再从菜单点【开始运行】即可重跑。
- **坑**：`runtime.log` 不存在（用 `console.log` / `runtime.process.log`，页面用 `wemod.log`，否则 Rhino 报 `TypeError: Cannot find default value for object`）；原生 `<select>` 会被宿主自动升级为页面内下拉（直接写 select，别再造一套）；首帧透明（防白闪，关键 UI 别太晚渲染）；别依赖 `html,body{height:100%}` 撑满（固定 header/footer + 中间 `overflow-y:auto`，或 `position:fixed; inset:0`）；标题栏归谁画看 `title` 是否为空；调试看 logcat `H5OverlayHost` / `H5RunGate` / `WeMod/HOST`。

## 版本与模型基准

- 数据基准：模型快照 **2026-09-28**（含 Shell 命令、按键注入、截屏保存位置等本轮新增；校准内容见 `SKILL.md` 顶部说明）。
- **2026-11-04：补 H5 章节（`SKILL.md` §6，只改文档）** —— 运行前菜单 `runGate`、页面 API `window.wemod`、`wemod.screen()`、窗口尺寸优先级、脚本侧 `runtime.h5`、H5 常见坑与自查。动作模型与校验器**无变更**（校验器不校验 HTML/JS 内容）。内置示例项目：`sample_project_h5_gate` / `sample_project_h5_events`（App 帮助中心 → 示例中心）。
- 若你手机上的 App 版本与技能包版本不一致：**先导入一个样例脚本实测**；不一致时**以 App 内的模型为准**。
- 维护者流程：改完 `SKILL.md` 后跑一遍 `node tools/validate-script.mjs examples/*.axs` 与 `node tools/validate-axsp.mjs`，全绿再提交。

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