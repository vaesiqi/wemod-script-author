# WeMod 自动化脚本作者 · 技能包

> 把一句需求写成**可直接导入运行**的自动化脚本 JSON。本技能包**自包含、零源码依赖**——没有项目源码也能写脚本、跑离线校验、产出可用交付物。
>
> 许可：[MIT](LICENSE)

## 这是什么

一套面向 AI 助手（Reasonix / Claude Code 等支持 `SKILL.md` 的工具）的**技能包**，蒸馏自 WeMod 安卓自动化项目的三大引擎真实实现（字段名 / 枚举 / 语义已**全部内嵌**进 `SKILL.md`，不是链接到源码）：

| 引擎 | 覆盖 |
|---|---|
| 动作模型 | 22 种节点、全部动作类型（含按键注入、Shell 命令、截屏、AI 视觉 / 回复 / 代理）、ActionConfig、条件模型、NodeSelector、虚拟控件、枚举全集 |
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
#    检查项：JSON 语法 / 必填字段 / 枚举值 / 引用完整性 / consoleVariables 类型

# 3) 上手机
#    脚本本体就是 JSON：改后缀为 .axs，用文件管理器打开（或在 App 内导入）→ 完整导入，保留控制台变量 / 设置 / 虚拟控件。
#    注意：编辑器里的「粘贴 JSON」只插节点、不带顶层设置，完整导入必须走 .axs。
```

## 版本与模型基准

- 数据基准：模型快照 **2026-09-16**（本次校准内容见 `SKILL.md` 顶部说明）。
- 若你手机上的 App 版本与技能包版本不一致：**先导入一个样例脚本实测**；不一致时**以 App 内的模型为准**。
- 维护者流程：改完 `SKILL.md` 后跑一遍 `node tools/validate-script.mjs examples/*.axs`，全绿再提交。

## 贡献

欢迎提 Issue / PR：补字段、修正语义、新增样例（**新样例必须能被 `tools/validate-script.mjs` 跑通**）。

## 免责声明

本技能包只提供"如何编写自动化脚本"的知识与工具。使用者应自行确保脚本用途**符合目标平台的服务条款与所在地法律法规**；因使用本技能包产生的任何后果由使用者自行承担。

## 许可

[MIT](LICENSE)