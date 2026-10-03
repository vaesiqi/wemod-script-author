---
name: wemod-script-author
description: 依据 WeMod 项目动作模型、变量引擎与执行引擎的真实能力，把用户需求编写成可直接导入 App 并运行的脚本 JSON（节点/块/动作/条件/变量/虚拟控件全能力），并做能力边界自查。
---

# WeMod 自动化脚本作者

本技能蒸馏自 `script-runtime/src/main/kotlin/com/wemod/automation/model/`（动作模型）、`core/expression/`（变量引擎）、`core/execution/`（执行引擎）的真实实现。目标是：**拿到用户一句需求，写出一份字段全部真实存在、语义符合执行引擎、能通过 ScriptValidator 的脚本 JSON**。

> **自包含使用说明（放 GitHub 给别人用时先读这里）**
> - **本技能包运行时零源码依赖**：写脚本所需的全部字段名/枚举值/语义都已内嵌在本文档（§3~§5），加上 `examples/` 黄金样例与 `tools/validate-script.mjs` 离线校验器，**不拥有 WeMod 源码也能写出可导入运行的脚本**。
> - 使用流程：读本文档 → 对照 `examples/auto-douyin-skin-001.axs` → 写 JSON → `node tools/validate-script.mjs 你的脚本.axs` 预检 → 改后缀 `.axs` 导入手机 App。
> - 数据基准：script-runtime 模型快照 **2026-09-28**（本轮校准：新增 **Shell 命令** 动作 `shell_command`（任意命令 + 结果写变量 + 执行前确认；只走 shell，需 Shizuku 或 root）、**按键注入** `key_event`（74 键 + 组合键，组合键需 Android 12+）、`take_screenshot.saveTarget`（自定义路径 / 系统相册）、`global_action` 扩到 10 项（音量 / 截图键 / 锁屏 / 电源菜单 / 粘贴）；上一轮（2026-09-16）校准：识别侧补 `allTextFormat`/`templatePath` 资源外置/`colorVarKeys` 附加颜色从变量读/`suppressRadius` 等字段与 **OCR 行级匹配行为**；变量侧补 `ConsoleVariableBinding` 的 `label/description/group/layoutMode`；JS 侧修正 `setCookie/getCookie` 首参为 URL）。若你手机上的 App 版本与技能包版本不一致，先导入一个样例脚本实测；不一致时以 App 内的模型为准（维护者校准流程见技能包 README「维护」）。
> - 完整导入请走 **`.axs` 文件**（保留控制台变量/设置/虚拟控件）；编辑器「粘贴 JSON」只插节点、不带顶层字段。

## 0. 定位与边界

- 产出物：**一个 `.json` 脚本文件**（脚本即 JSON，由 App 的 ScriptRepository / 编辑器导入运行）。不是 Kotlin 代码。
- 脚本在手机端运行，能力上限 = 动作模型 + 变量表达式 + JS run_code，不要幻想不存在的 API。
- 关键能力边界（写之前先对照，避免交付跑不动的脚本）：
  - 无 `{{变量}}` 语法；变量引用是 **表达式直接写变量名**、**VarKey 字段直填**、**Prompt 模板 `${...}`** 三种。
  - 无三元运算符（用 `if(cond,a,b)` 函数）；数组**不能原地改**（只能整体重建后 SetVar）；无 ArrayPush 动作。
  - `run_code` 的 JS 里 `runtime.variables.set` 支持直接存 JS 数组（S1452：入口自动转 Kotlin List，表达式侧可索引/len/contains），JS 对象兜底转文本；写的是 LOCAL 作用域（子流程内返回回滚）。
  - `repeat`/`while_var` 循环里可用 `break`/`continue`；`if` 不消费 break/continue。
  - `Repeat.times` 必须 >0（不支持无限次数）；无限循环用 `ActionConfig.repeat=-1` 或 `settings.runCount=0`。
  - 节点查找类动作（`node_*`/`find_and_*`/`wait_node` 等）**依赖无障碍服务**；纯坐标动作可走 Shizuku/root。
  - 视觉类动作（`*vision*`/`click_color`/`click_text`/`click_image`/`scroll_until_vision`）**依赖屏幕录制（MediaProjection）**。
  - 写脚本时所有坐标/区域**同时给像素值（`x/y`）和百分比（`xPct/yPct`）**：运行时 `xPct` 在 `0f..1f` 时优先按百分比×当前屏幕，否则回退像素值；`xPct=-1f` 表示"未设置"。**单指/多指手势的每个路径节点也照此双写**（见 3.2.1）。

## 1. 交付流程（五步）

1. **澄清需求**：目标 App/页面、要完成的流程、循环条件、变量需求、是否需要虚拟控件/弹窗交互/网络/文件。缺关键信息就问（屏幕基准分辨率可默认 1080×2400）。
2. **结构设计**：画节点树——主流程块 + 循环（`repeat`/`while_var`/`while_vision`）+ 分支（`if`/`var_switch`）+ 子流程（`subflow_def`/`call_subflow`）+ 事件监听（`event_listener`）。需要用户可调参数 → 加 `consoleVariables` 面板变量。
3. **编写 JSON**：按第 2~5 节填字段。默认值可省略（序列化 `encodeDefaults=false`，未知字段忽略，数值非法值可被导入器 coerce）。
4. **静态自查**：按第 7 节清单逐项过一遍（引用目标存在、循环可退出、需求权限齐全、坐标双写）。
5. **离线预检**：`node tools/validate-script.mjs <脚本.axs>` 跑一遍校验器，零错误才交付。
6. **交付**：输出完整 JSON + 一句话说明（运行需求：无障碍/Shizuku/root/屏幕捕获；导入方式：改后缀 `.axs` 用 App 打开导入）。

## 2. 脚本 JSON 骨架与序列化规则

### 2.1 顶层结构（`model/Script.kt`）

```json
{
  "id": "脚本ID-UUID",
  "name": "脚本名",
  "root": { "nodes": [ ... ] },
  "settings": { "runCount": 1, "defaultActionPreDelayMs": 1000, "defaultActionPostDelayMs": 0, "pauseOnRuntimeError": true },
  "consoleVariables": [],
  "consolePresets": [],
  "virtualControls": [],
  "virtualControlSchemes": [],
  "baseScreenWidth": 1080,
  "baseScreenHeight": 2400,
  "confirmedCheckItems": [],
  "createdAt": 0,
  "updatedAt": 0
}
```

- `root.nodes` 是唯一必填执行体；`settings` 可省（有默认值）。`runCount=0` 表示无限次循环执行整个脚本。
- 变量**没有**独立"变量区"：变量在节点树里用 `set_var`/`inc_var`/`get_var` 内联定义；控制台可调参数用顶层 `consoleVariables` 声明。
- 其余顶层字段：`consolePresets`（控制台预设）、`virtualControls`/`virtualControlSchemes`（虚拟控件与布局方案）、`confirmedCheckItems`（运行前确认项）、`createdAt`/`updatedAt`；另有**发布/分享元数据字段**（`publishMeta`/`importedFromShare`/`encryptedSource`/`nodeCountHint`/`resolutionWarningSuppressed`）由 App 维护，手写脚本可全部省略。
- 序列化：判别字段统一为 **`"type"`**（sealed class 子类的 `@SerialName`），字段名即 Kotlin 属性名。必填字段 = 无默认值的字段。

### 2.2 最小可用脚本

```json
{
  "id": "demo-001", "name": "示例",
  "baseScreenWidth": 1080, "baseScreenHeight": 2400,
  "root": { "nodes": [
    { "type": "set_var", "key": "retry", "value": 0, "scope": "LOCAL" },
    { "type": "action",
      "action": { "type": "tap", "x": 540, "y": 1100, "xPct": 0.5, "yPct": 0.458 },
      "config": { "preDelayMs": 500 } },
    { "type": "if",
      "conditions": { "mode": "ALL", "items": [
        { "type": "vision", "condition": { "type": "text_exists",
          "left": 200, "top": 600, "right": 900, "bottom": 1200, "text": "高德" } } ] },
      "thenBlock": { "nodes": [] }, "elseBlock": { "nodes": [] } }
  ] }
}
```

## 3. 动作模型（节点 / 动作 / 配置 / 枚举）

### 3.1 节点类型（`model/ActionNode.kt`，`root.nodes[]` 的元素）

每个节点都有通用字段：`enabled=true`、`id`（节点引用标识，供 Goto/事件/条件引用）、`displayName`、`comment`、`jumpLabel`。

| JSON `type` | 类 | 用途与关键字段 |
|---|---|---|
| `action` | Action | 原子动作。`action:{...}` 必填（见 3.2），`config:ActionConfig`（见 3.3） |
| `if` | If | 分支。`conditions`(ConditionGroup) 或兼容字段 `condition`(VisionCondition)/`timeCondition`/`varCondition` 四选一，`thenBlock`/`elseBlock` |
| `var_switch` | VarSwitch | 多分支。`key`、`matchMode`(TEXT_EQUALS/TEXT_CONTAINS/NUMBER_EQUALS)、`cases:[{matchValue, block}]`、`defaultBlock` |
| `repeat` | Repeat | 定次循环。`times`(>0)、`timesVarKey`、`block`、`intervalMillis=200` |
| `block` | Block | 纯结构分组，不改变语义。`block`、`config`(可带 RANDOM 顺序) |
| `try_catch` | TryCatch | `tryBlock`/`catchBlock`；try 内动作失败进 catch |
| `race` | Race | 并行竞速。`leftBlock`/`rightBlock`，先完成者生效、另一路取消 |
| `subflow_def` | SubFlowDef | 子流程定义（**只定义不执行**）。`name`、`params:[{name,defaultValue,required}]`、`block` |
| `call_subflow` | CallSubFlow | 调用子流程。`targetName`、`paramBindings:[{name,value}]`（**value 走 `${变量}` 插值 + 数字自动转换**，如 `{"name":"题号","value":"${命中题号}"}`）；**进入时局部变量快照、返回后恢复=子流程内 LOCAL 写入会被回滚**（跨子流程回传结果必须写 GLOBAL）；子流程可读外层 LOCAL（合并视图）；深度>20/递归调用报错 |
| `event_listener` | EventListener | 事件监听（见 5.4）。`eventName`、`targetSubFlow`、`async=true`、`writeEventToVars=true` |
| `label` | Label | `name`（Goto 目标） |
| `goto` | Goto | `target`（Label name 或 nodeId）。当前块找不到**向上冒泡**；不支持跳进子块 |
| `set_var` | SetVar | `key`、`value`(JsonElement，四形态见 4.3)、`scope=LOCAL`；**`items:List<VariableItem>`（多变量：非空时逐条执行且优先于单条 key/value，见 4.3）** |
| `inc_var` | IncVar | `key`、`delta=1.0`、`scope`；不存在按 0 处理；**`items`（多变量增量，同上）** |
| `get_var` | GetVar | 变量拷贝。`sourceKey`→`targetKey`、`targetScope`；**`items`（多变量拷贝：每项 `sourceKey`→`key`）** |
| `while_var` | WhileVar | 变量循环。`key`、`op`(LT/LE/EQ/NE/GE/GT)、`value`(Double 字面量)、**`valueVarKey`（S1452：上界从变量读，非空优先于 value，解析失败回退字面量）**、`block`、`intervalMillis=200`、`maxIterations=10000` |
| `while_vision` | WhileVision | 视觉循环。`condition`(VisionCondition)、`block`、`intervalMillis=200`、`timeoutMillis=10000`、`maxIterations=10000` |
| `break` | Break | 终止最近一层循环（Repeat/While） |
| `continue` | Continue | 跳过当前轮次进入下一轮 |

### 3.2 动作类型全清单（`model/ScriptAction.kt`，共 52 种，`action.type`；另有 `unknown_type` 兜底类，不要手写）

**坐标基础动作**（可走 Shizuku/root 后端）：

| type | 类 | 关键字段（必填加粗） |
|---|---|---|
| `tap` | Tap | **x,y**、duration=50、xPct/yPct=-1f、pointVarKey、durationVarKey |
| `multi_tap` | MultiTap | **x,y**（+ xPct/yPct）、count=2、intervalMs=80、duration=50 |
| `touch_down` | TouchDown | **x,y**（+ xPct/yPct）、pointerId=1、holdMs=10000 |
| `touch_up` | TouchUp | pointerId=1、releaseMs=50 |
| `move_pointer` | MovePointer | touchDownRefId=""(引用 touch_down 的 pointerId)、x/y=-1（+ xPct/yPct）、duration=300、pathType=LINE |
| `drag_to_target` | DragToTarget | **startX,startY**（+ startXPct/startYPct）、targetType=COORDINATE/NODE/VISION、targetX/Y 或 targetSelector 或 targetCondition（+ targetXPct/targetYPct）、duration=400、waitTimeoutMs=3000 |
| `long_press` | LongPress | **x,y**（+ xPct/yPct）、duration=500 |
| `swipe` | Swipe | **fromX,fromY,toX,toY**（+ fromXPct/fromYPct/toXPct/toYPct）、duration=300、useBezierCurve=false、bezierCurveFactor；起点/终点可来自 IMAGE/TEXT/COLOR（fromSourceType/toSourceType） |
| `single_touch` | SingleTouch | **pointer**(TouchPointer：**pathNodes 路径节点数组**、duration、pathType=POINT/LINE/POLYLINE/RECORD/CURVE、segments 多段)；见 3.2.1 |
| `multi_touch` | MultiTouch | **pointers:List\<TouchPointer\>**（多指轨迹，每根手指一套 pathNodes）；见 3.2.1 |
| `click_color` | ClickColor | **condition**(ColorAt)、outputs |
| `click_text` | ClickText | **condition**(TextExists)、outputs |
| `click_image` | ClickImage | **condition**(TemplateMatch)、outputs |

### 3.2.1 单指 / 多指触控与触点路径节点（`single_touch` / `multi_touch`）

模型：`SingleTouch.pointer: TouchPointer`、`MultiTouch.pointers: List<TouchPointer>`（每根手指一个触点）。
**触点是「有序路径节点」模型**（S-触控-路径-1）：旧字段 `points` + 单一目标已被 `pathNodes` 取代。

**TouchPointer（一根手指）**

| 字段 | 说明 |
|---|---|
| `pathNodes: List<TouchPathNode>` | **必填、至少 1 个**（模型无默认值，缺失 ⇒ 整个脚本导入失败）。运行前**先把非坐标节点全部解析成功，再派发整段手势**；任一节点解析失败 ⇒ 动作失败（不会用兜底坐标继续） |
| `duration: Long` | **必填**，整条路径耗时（ms） |
| `pathType` | `POINT`（只用第 1 个节点）/ `LINE`（首尾两点）/ `POLYLINE`（全部节点折线）/ `RECORD`（录制回放折线）/ `CURVE`（全部节点 + 贝塞尔平滑） |
| `bezierCurveFactor` | 贝塞尔平滑系数（与 `swipe` 同名同义：0=直线、1=默认、>1 更弯），仅 `CURVE` 生效 |
| `durationVarKey` | 路径时长从变量读 |
| `startDelayMs` / `startDelayMsVarKey` | 该手指**晚于其他手指按下**的延迟（多指动作里做先后手） |
| `segments: List<TouchSegment>?` | 多段触摸：同一手指的多次独立按下片段（段间抬起），如「手指 1 持续滑动期间手指 2 连点」。非空时按 segments 逐段驱动；**无障碍后端无法表达段间抬起，会退化为单段** |

**TouchPathNode（路径上的一个点，自带来源）**

| 字段 | 说明 |
|---|---|
| `sourceType` | `COORDINATE`（默认，静态坐标）/ `VARIABLE`（坐标变量）/ `IMAGE` / `TEXT` / `COLOR`（视觉条件）/ `NODE`（无障碍选择器）/ `TOUCH_DOWN`（引用某 `touch_down` 动作的坐标） |
| `x`、`y` **+** `xPct`、`yPct` | **COORDINATE 的坐标必须双写**：像素 `x/y` + 百分比 `xPct/yPct`（0~1）。运行时 `xPct ∈ 0f..1f` 时**优先**按「百分比 × 当前屏幕」，否则回退 `x/y`（`xPct=-1f` 表示未设置）。跨分辨率稳不稳就看这里 |
| `pointVarKey` | `VARIABLE`：坐标变量名 |
| `condition` | `IMAGE`(TemplateMatch) / `TEXT`(TextExists) / `COLOR`(ColorRegion) 的视觉条件 |
| `selector` | `NODE`：节点选择器 |
| `touchDownRefId` | `TOUCH_DOWN`：被引用的 `touch_down` 动作节点 id（或 pointerId） |
| `sustainMs` | 到达该点后原地停留（ms），0=不停 |
| `durationToHereMs` | 从上一个节点走到该点耗时（ms），0=按总时长匀速 |

约定：

- **每根手指的每个坐标点都要双写**（`single_touch` 与 `multi_touch` 一致；校验器会逐个 pathNode 提示）。
- 时序：`durationToHereMs` / `sustainMs` 都不写时整条路径按 `duration` 匀速；写了就按时间检查点走。
- 旧 `points` 写法仍能导入（读取时迁移为 `pathNodes`，`xPct/yPct` 一并搬运），但**新脚本请直接写 `pathNodes`**。
- 双指缩放这类「第一根手指按住不动、第二根手指移动」用不同 `startDelayMs` + 各自 pathType 表达；多指同时移动 = 同时按住并一起移动（各自 `pathNodes` 各自轨迹），不是两次点击。

```json
{ "type": "single_touch",
  "pointer": {
    "pathType": "LINE", "duration": 400,
    "pathNodes": [
      { "sourceType": "COORDINATE", "x": 324, "y": 1200, "xPct": 0.3, "yPct": 0.5 },
      { "sourceType": "COORDINATE", "x": 756, "y": 1200, "xPct": 0.7, "yPct": 0.5 }
    ] } }
```

```json
{ "type": "multi_touch",
  "pointers": [
    { "pathType": "POINT", "duration": 120, "startDelayMs": 0,
      "pathNodes": [ { "sourceType": "COORDINATE", "x": 324, "y": 600, "xPct": 0.3, "yPct": 0.25 } ] },
    { "pathType": "POINT", "duration": 120, "startDelayMs": 60,
      "pathNodes": [ { "sourceType": "COORDINATE", "x": 756, "y": 1800, "xPct": 0.7, "yPct": 0.75 } ] }
  ] }
```

**无障碍语义级**（依赖无障碍服务）：

| type | 类 | 关键字段 |
|---|---|---|
| `find_and_click` | FindAndClick | viewId/text/description/className 可空、clickable=true |
| `find_and_input` | FindAndInput | **inputText**、targetViewId/targetText/targetDescription/targetClassName 可空 |
| `scroll_to_find` | ScrollToFind | **text**、maxScrolls=10、direction=DOWN、intervalMs=180 |
| `node_click` | NodeClick | **selector**(NodeSelector) |
| `node_double_click` | NodeDoubleClick | selector、intervalMs=80 |
| `node_long_press` | NodeLongPress | selector |
| `node_input` | NodeInput | selector、**inputText**、clearBeforeInput=false、submitMode=NONE、verify（S1452：submitMode 支持 TAP_COORDINATE/ENTER_KEY/**AUTO_TEXT（OCR 关键词 submitTextKeywords）/AUTO_TEMPLATE（模板 submitTemplateBase64）** + **submitDelayMs 提交前延迟 0~5000 默认 500 防键盘收起按钮位移**） |
| `wait_node` | WaitNode | selector、appear=true、timeoutMs=null、intervalMs=200、outputs(NodeWaitResultBindings)、timeoutMsVarKey |
| `check_node` | CheckNode | selector、outputs（单次检测，不等待不抛错） |
| `get_node_info` | GetNodeInfo | selector、outputs(NodeInfoResultBindings)（P1-2 通用属性读取：一次查询不等待不抛错，可读文本/描述/ID/类名/包名/坐标/边界/勾选/可用/可点/可滚动/深度/索引/稳定路径等） |
| `node_clear_input` | NodeClearInput | selector |
| `node_focus` | NodeFocus | selector |
| `node_set_checked` | NodeSetChecked | selector、checked=true |
| `node_swipe` | NodeSwipe | selector、direction=UP/DOWN/LEFT/RIGHT、distanceRatio=0.7f、durationMs=280 |

**无控件输入**：

| type | 类 | 关键字段 |
|---|---|---|
| `no_control_input` | NoControlInput | **inputText**、trigger=LONG_PRESS/TAP、longPressMs=600、doEnter、submitMode、verify（S1452：submitMode 支持 TAP_COORDINATE/ENTER_KEY/**AUTO_TEXT（OCR 关键词 submitTextKeywords）/AUTO_TEMPLATE（模板 submitTemplateBase64，属性面板框选拾取）** + **submitDelayMs 提交前延迟 0~5000 默认 500**；坐标均支持屏幕点选拾取） |

**视觉动作**（依赖屏幕录制；condition 均为 VisionCondition）：

| type | 类 | 关键字段 |
|---|---|---|
| `scroll_until_vision` | ScrollUntilVision | **condition**、maxScrolls=10、direction、swipeDuration=300 |
| `wait_for_vision` | WaitForVision | **condition**、timeoutMillis=null、outputs |
| `check_vision` | CheckVision | **condition**、outputs（单次，无条件继续） |
**网络/系统/文件/运行控制**：

| type | 类 | 关键字段 |
|---|---|---|
| `delay` | Delay | **millis**(Long 必填)、millisVarKey（等待） |
| `ensure_screen_on` | EnsureScreenOn | wakeLockDurationMs=5000 |
| `take_screenshot` | TakeScreenshot | saveToPath=""、bindToVar=""、**left/top/right/bottom(+Pct) 区域字段（P1-1 区域截图，任一 pct 在 0..1 或像素区域有效时只截该区域，否则全屏）**、format=PNG/JPEG、**saveTarget=CUSTOM_PATH（默认，写入 saveToPath，留空则只写变量）/GALLERY（系统相册：经 MediaStore 写 Pictures/WeMod、按时间自动命名、相册立即可见，Android 10+ 免存储权限）** |
| `run_code` | RunCode | language="javascript"、code、codeVarKey、bindResultToVar、timeoutMs=30000、templates（JS API 见 5.5） |
| `ai_vision` | AiVision | prompt、aiConfig(provider/baseUrl/model/apiKeyVarKey；**baseUrl/apiKey 走全局 AI 设置**)、**regionMode=FULL_SCREEN(全屏识别)/LOCAL(区域识别，都返回坐标；LOCAL 模型返回相对区域的坐标，运行时自动换算成屏幕坐标)**、**referenceImage/referenceImageVarKey（参考图，模型对照找相似目标）**、**refineByTemplate（两段式精定位：模型粗定位后用参考图做 OpenCV 模板匹配取像素级精确坐标，默认开）**、**maxEdgePx（发送图最长边等比缩放，0=默认 1536；调小省 token 精度略降——全屏 1080×2362 时 1536→发送 702×1536，768→351×768 token 约省 4 倍）**、outputs(exists/x/y/**point("x,y")**/text)、bindToVar（S1450：截图→大模型→JSON 写变量；**写出的 x/y/point 始终是屏幕坐标，可直接被 tap 等动作 pointVarKey 读取**；**prompt 支持 ${变量} 插值 + 内置提示模板下拉**） |
| `ai_reply` | AiReply | prompt、aiConfig、**noVision（纯文本模式，适配 DeepSeek 等无视觉模型）+ ocrContext（纯文本模式下的界面上下文：本地 OCR 提取屏幕文字随 prompt 发给模型，纯文本模型也能看懂屏幕；**ocrMySide(RIGHT/LEFT 我方气泡侧：OCR 上下文按左右侧区分"用户/我"消息、去重、按最新对方消息回复)**）**、**memoryMode(NONE/SESSION：本次脚本运行内累积历史对话，跨多个 ai_reply 动作共享，多轮回复场景）+ memoryWindow(1~20，记忆轮数)+ memoryScopeVarKey（会话标识变量：微信多用户场景先把用户 ID 写入变量再填这里，记忆按用户隔离互不串扰；留空=脚本级单一会话）+ memoryPersist（持久化记忆：跨脚本运行保存到本机、下次同会话自动恢复；AI 设置页可一键清除）**、bindToVar、autoSend、confirmBeforeSend、inputTargetType(FOCUS/NODE/COORD)、sendTargetType(COORD/NODE)+**verify（输入后效验，与 node_input 同款：FIXED_DELAY/NODE_TEXT_CHANGED/OCR_TEXT_CHANGED 等，确认回复真的输入成功）+**sendDetectMode(COORD/AUTO_TEXT/AUTO_TEMPLATE：发送按钮自动识别——OCR 找「发送」等关键词文字或模板匹配按钮图标，防键盘收起按钮位移点错)+sendTextKeywords(逗号分隔关键词)+sendTemplateBase64(发送按钮模板图，属性面板框选拾取)+sendDelayMs(0~5000 发送前延迟，默认 500)**；**坐标支持屏幕点选拾取**（S1450：生成回复+自动输入发送；S1451：会话记忆+OCR 上下文；S1452：发送增强） |
| `ai_agent` | AiAgent | goal、maxSteps、stopKeyword、aiConfig（S1450：给目标→循环截图→白名单动作执行→模型判定完成；**坐标用比例 xp/yp（0~1 相对屏幕宽高，程序换算像素），兼容旧 x/y 像素**）、**可配置执行参数：allowedActions(动作白名单 tap/swipe/input/back/home/run_code/**wait/open_app**/**全部节点动作**(node_click 按文字点击/node_double_click/node_long_press/node_input/node_clear_input/node_focus/node_set_checked/node_swipe/wait_node/check_node/get_node_info)**+OCR/视觉/系统动作**(click_text OCR文字点击/wait_for_vision/check_vision/scroll_to_find 滚动找文字/ensure_screen_on 亮屏/open_link 打开链接)**+手势动作**(long_press 长按/single_touch 单指轨迹 points 数组/multi_touch 多指触控 fingers 数组/double_tap 双击/multi_tap 连点/drag_to_target 拖拽)，空=全禁；**默认已全部放开**，模型可像真人一样动态操作；属性面板为**下拉多选**（收起显示已启用摘要），模型动作格式：节点动作用 text/desc/className 定位，OCR 文字动作用 text，手势动作比例坐标 xp/yp)、maxActionsPerStep(单步上限)、staleStreakLimit(连续相同无进展阈值，0=关)、maxSystemNavPerStep(back/home 上限，0=不限制)、historyLimit(记忆条数，0=关)、inputTextMax(输入截断)、toolCallLimit(每步工具调用上限，0=禁用；模型可**主动**输出 `{"type":"tool","name":"get_node_tree"|"run_js"|"get_device_state"|"open_app"|"wait_ui_event"|"run_shell"|"get_notifications"|"plan","params":{...}}` 发起查询：get_node_tree 读界面节点树、run_js 执行 JS、get_device_state 读前台应用/无障碍状态（轻量）、open_app 打开应用、wait_ui_event 等界面文字出现（事件驱动省 token）、run_shell 执行沙箱 shell（白名单只读诊断命令 dumpsys/getprop/ps，需 AI 设置开启 Shell 能力+执行时弹确认，Shizuku 授权即用无需 root）、get_notifications 读最近通知（需授权「通知使用权」，判断外部消息）、plan 复杂任务先规划子任务（AgentScope PlanNotebook 式，写 agent_plan/agent_plan_progress 变量，全部完成输出结束词），结果回传同一步继续决策，不消耗步数)、nodeContextMaxNodes(get_node_tree 节点摘要条数)、confirmMode(敏感操作审批策略，空=继承设置页全局；NEVER/ON_REQUEST/ALWAYS)、actionDelayMs(动作后稳定延迟ms，0=继承设置页全局1500)**（S1453-23k 行为图记忆（AppAgentX 长期演进）：记录"界面状态键（前台包名+可点击文字）→ 成功动作 JSON"跨运行积累（存本机 AiMemoryStore scope=behavior），同界面成功动作 ≥2 次 → 注入 prompt【历史成功经验】直接复用（学一次以后变快变省，软性脚本进化不改脚本文件）；只记成功动作（wait/back/home 除外）、每状态最多 30 条、运行结束 flush；设置页 `agentBehaviorLearning` 默认开，关闭即清空历史。S1453-23g 修复：**后续步也保持完整动作格式+工具清单（失败重试规则仅首步注入），杜绝模型退化——曾因 compact 精简模板导致第 2 步起模型无有效动作；open_app 支持动作（{"type":"open_app","packageName":"com.android.chrome"}）与工具双通道。S1453-23b 决策层：失败重试规则（先 wait→微调重试一次→跳过并说明；同元素最多 2 次；wait 最多 3 次→back 重进；工具失败修正重试≤2 次）；**反思**——截图指纹（8x8 灰度 hash）对比，界面连续 ≥2 步无变化自动提示模型换策略；历史超限结构化压缩（最旧两条合并）。S1453-23a 动作协议：**`wait` 原语** ms 100~5000 模型显式等转场/加载，配"连续 wait 最多 3 次"规则；**`confirm` 敏感标记**——动作带 `"confirm":true`（支付/删除/发送/登录类）执行层弹确认，审批 NEVER/ON_REQUEST/ALWAYS；**坐标越界回传模型自愈**（不再静默裁剪）；**黑屏/敏感页自动停手**——设置页 `agentBlackScreenStop` 默认开，截图全黑（支付/密码页特征）自动停止转人工）。S1453-24b~i 实用性升级：**每步自动注入【当前界面】无障碍节点摘要 + 【脚本】名 + 【脚本已执行动作】历史（最近 20 条含失败标记）+ 【脚本变量】摘要（前 20 个用户变量，值截断 60 字符）**——模型无需主动调 get_node_tree 也能看见界面结构与脚本上下文（复用中间结果/写回正确变量）；任务收尾：模型输出结束词时可**同步输出 back/home 收尾动作**（执行层 stopHit 不再短路丢弃，仅允许 back/home/wait 且跳过敏感确认）；发送图分辨率 `maxEdgePx`(0=默认1536，属性面板 256~2048 六档，长任务省 token)；`timeoutMs`(10~120 秒默认 30000，智谱等视觉模型高峰期易 504 可调大)；循环任务引导（重复上滑/连点可用 run_code 写 JS 循环省步数）** |

> **AI 供应商与模型（S1450，`aiConfig.provider`）**：内置预设 `QWEN`(通义千问，模型 qwen-vl-plus/qwen-vl-max/qwen2.5-vl-72b-instruct)、`GLM`(智谱，glm-4v/glm-4v-plus/**glm-4v-flash 官方免费视觉模型**，三个 AI 动作零成本可用；设置页/属性面板模型下拉标「免费」)、`OPENAI`(gpt-4o-mini/gpt-4o/gpt-4.1-mini)、`DEEPSEEK`(deepseek-v4-flash/deepseek-v4-pro 纯文本 + **deepseek-v4-flash-vision-exp 多模态 2026-08 官方推出，可跑 ai_vision/ai_reply 视觉模式/ai_agent**；视觉能力按**模型级**判断 modelSupportsVision)、`CUSTOM`(自定义 baseUrl+model)。`baseUrl`/`apiKey` 走 App 全局 AI 设置（不落脚本 JSON，校验工具拦截明文 apiKey）；脚本内可用 `apiKeyVarKey` 指向变量做运行时覆盖。**模型下拉的候选 = 供应商预制 + 全局 AI 设置页手动添加的模型（单一事实源在设置页，可添加新模型/私有模型）**。
| `http_request` | HttpRequest | method=GET/POST/PUT/DELETE/PATCH/HEAD、url、headers:Map、body、bodyType=TEXT/JSON/FORM_URLENCODED、timeoutMs=10000、retryTimes=0、responseType=TEXT/BYTES、responseBindToVar、statusCodeBindToVar |
| `file_action` | FileAction | op=READ/WRITE/WRITE_BYTES/APPEND/DELETE/EXISTS/LIST_DIR/ENSURE_PATH、path、content、encoding="UTF-8"、bindToVar |
| `global_action` | GlobalAction | **action**=BACK/HOME/RECENTS/NOTIFICATIONS/VOLUME_UP/VOLUME_DOWN/SCREENSHOT（截图键）/LOCK_SCREEN（电源键·短按锁屏）/POWER_MENU（电源键·长按菜单）/PASTE（粘贴键：优先无障碍"焦点粘贴"，无需 Shizuku；失败才回落 shell 注入） |
| `key_event` | KeyEvent | **key**=按键（A~Z / 0~9 / DPAD_UP·DOWN·LEFT·RIGHT·CENTER / 符号 / ENTER·ESC·TAB 等功能键 / F1~F12）、modifiers=[SHIFT/CTRL/ALT/META]（组合键，如 Ctrl+C）、longPress（长按，仅单键）；**只能走 shell（Shizuku 或 root）**，组合键还需 Android 12+ 的 input keycombination |
| `shell_command` | ShellCommand | **command**（任意 shell 命令，支持 `${变量}` 插值；不做白名单，白名单只约束 AI 的 run_shell）、bindResultToVar（把**完整输出**写入变量，留空则不写）；**只能走 shell（Shizuku 或 root）**，无障碍后端跑不了；输出进运行日志（截断 2000 字符）；执行前**默认弹确认框**（同意 / 不同意 / 本次运行始终允许），设置页「执行确认」可关 |
| `open_app` | OpenApp | **packageName** |
| `open_link` | OpenLink | **uri**、target=URL/FILE/APP_ACTIVITY、uriVarKey |
| `prompt` | Prompt | 弹窗交互（见 3.4） |
| `run_control` | RunControl | controlType=PAUSE/STOP/JUMP/CALL/NODE_ENABLED、jumpLabel、callSubFlowTarget、nodeEnableTargetId 等 |
| `run_script` | RunScript | **scriptId**、waitForFinish=true、inheritVariables=true、variableBindings（仅继承 global 变量） |

**脚本级 / 虚拟控件**：

| type | 类 | 关键字段 |
|---|---|---|
| `switch_virtual_control_scheme` | SwitchVirtualControlScheme | schemeId/schemeName |
| `trigger_virtual_button` | TriggerVirtualButton | controlId/controlName、triggerType=DEFAULT_ACTION/TAP/LONG_PRESS_RELEASE/PRESS_DOWN/RELEASE |
| `virtual_button` | VirtualButton | 注册虚拟按键（见 6.3） |
| `virtual_joystick` | VirtualJoystick | 注册虚拟摇杆（见 6.3） |

### 3.3 ActionConfig（每个 action/block 节点的通用运行配置，`model/ActionConfig.kt`）

| 分组 | 字段（默认） |
|---|---|
| 前后延时 | `preDelayMs=0`、`preDelayRandomRangeMs=0`、`postDelayMs=0`（各配 VarKey） |
| 次数 | `repeat=1`（**-1=无限**）、`repeatVarKey` |
| 运行条件 | `runtimeConditions:ConditionGroup?`、`condition:VisionCondition?`、`timeCondition` |
| 防检测抖动 | `coordJitterMinPx=0`、`coordJitterMaxPx=0`、`coordJitterVarKey`（数字 N→0~N 对称；"min~max"→区间） |
| 失败重试 | `retryTimes=0`（**-1=直到成功**）、`retryIntervalMs=200`（各配 VarKey） |
| 视觉轮询 | `conditionRetryTimes=0`（-1=直到满足）、`conditionRetryIntervalMs=200`、`conditionNegated=false`、`conditionMissStrategy=SKIP/FAIL` |
| 超时 | `timeoutMs=null`（<=0 不限制）、`timeoutMsVarKey` |
| 结果策略 | `onSuccess`/`onFail` = `CONTINUE/STOP/RETRY/GOTO`（默认 CONTINUE）；`jumpTargetOnSuccess/jumpTargetOnFail`、`successTargetType/failTargetType=LABEL/SUB_FLOW/ACTION` |
| 事件 | `events:ActionEvents`（onStart/onConditionSuccess/onConditionNotSuccess/onSuccess/onFail/onTimeout/onRetry/onFinish，每个绑定可 `targetType`=LABEL/SUB_FLOW/ACTION/INLINE_ACTION/VARIABLE） |
| 逻辑块顺序 | `executionOrder=SEQUENTIAL/RANDOM`（仅 block 节点） |

语义要点：动作执行 = 条件检查（未满足按 conditionMissStrategy SKIP/FAIL）→ preDelay → handler 执行（包 timeoutMs）→ 成功/失败策略（RETRY 重试 / GOTO 跳转 / STOP 取消 / CONTINUE 继续）→ postDelay。`repeat` 在外层包住整轮。

### 3.4 Prompt 弹窗（`prompt` 动作）

```json
{ "type": "action", "action": {
  "type": "prompt",
  "displayType": "DIALOG",            // DIALOG / SIMPLE / NOTIFICATION
  "title": "请输入", "content": "角色名=${角色名}",
  "controls": [                        // 新主数据；buttons/input 为旧兼容（controls 为空时回退）
    { "type": "input", "label": "角色名", "targetVariable": "角色名", "hint": "" },
    { "type": "button", "text": "确定", "style": "FILLED", "binding": "" },
    { "type": "switch", "label": "开启自动", "targetVariable": "自动", "default": false },
    { "type": "slider", "label": "次数", "targetVariable": "次数", "min": 0, "max": 100, "step": 1, "default": 10 },
    { "type": "checkbox", "label": "同意", "targetVariable": "同意", "default": false }
  ],
  "position": "CENTER", "durationMs": null, "vibrate": false
} }
```

- 控件写变量到 **LOCAL** 作用域；`content/title` 支持 `${变量}` 模板插值。

### 3.5 条件模型

**ConditionGroup**（`if.conditions` / `config.runtimeConditions`）：

```json
{ "mode": "ALL", "items": [
  { "type": "variable", "key": "金币", "op": "GE", "value": "1000", "negated": false },
  { "type": "expression", "expression": "count(识别框数组) > 0" },
  { "type": "vision", "condition": { "type": "text_exists", "left": 0, "top": 0, "right": 1080, "bottom": 2400, "text": "胜利" }, "retryTimes": 3 },
  { "type": "time", "condition": { "type": "IN_RANGE", "startHour": 9, "startMinute": 0, "endHour": 22, "endMinute": 0 } },
  { "type": "node", "selector": { "text": "开始" } },
  { "type": "screen_on" }, { "type": "screen_locked" },
  { "type": "action_run_status", "targetActionId": "node_1", "status": "success" },
  { "type": "run_count_limit", "maxCount": 3, "resetMode": "loop_end" }
] }
```

- `mode=ALL`(与)/`ANY`(或)/`N_OF`(满足 N 个，P1-5)；空组 = 满足。`op` 枚举：LT/LE/EQ/NE/GE/GT（`action_run_status.status` 写小写 `"success"/"failure"/"not_run"`；`run_count_limit.resetMode` 写 `"loop_end"/"script_end"/"script_open"`）。N_OF 用 `group.requiredMatchCount`（至少满足几个条件项）。

> **多颜色 OR 判定**：两种方式——
> 1. **条件组方式（框架原生）**：多个 vision 条件项 + `mode:"ANY"`（执行引擎 ANY 模式任一成功即短路），每个颜色独立容差/hitRatio，编辑器友好；
> 2. **单条件多颜色（P0-1 已落地，编辑器已支持）**：`color_region.colors: List<Int>` 与主色 `color` 并集判定，任一颜色命中即计命中点，`hitRatio` 作用于并集结果，FIND_TARGETS 可跨色找目标。条件属性面板（视觉条件/点击颜色/滑动等入口）的「附加颜色」列表可直接取色/增删。
> ```json
> { "type": "if",
>   "conditions": { "mode": "ALL", "items": [
>     { "type": "vision", "condition": { "type": "color_region", "left": 0, "top": 0, "right": 1080, "bottom": 2400, "leftPct": 0, "topPct": 0.05, "rightPct": 1, "bottomPct": 0.95, "color": -2183028, "colors": [-10066177, -65536], "tolerance": 30, "hitRatio": 0.2, "requireAverageMatch": false } }
>   ] } }
> ```
> 多模板同理：单条件 `template_match.templates: List<TemplateSpec>`（P0-2 已落地）并集匹配，任一模板命中即成功。
>
> **附加识别三件套（文字/颜色/图片均支持）**：
> - **文字**：`text_exists.texts`（附加文字）+ `textMatchMode`(ANY/ALL/N_OF) + `requiredMatchCount`
> - **颜色**：`color_region.colors`（附加颜色）+ **`colorVarKeys`（附加颜色从变量读**：与 `colors` 位置平行，非空时用该变量的颜色值覆盖） + `colorMatchMode` + `requiredMatchCount`
> - **图片**：`template_match.templates`（附加模板，每项含 `templateBase64`/`threshold`/`scaleMode`/基准分辨率）+ `templateMatchMode` + `requiredMatchCount`；**单模板可用 `templatePath` 走资源外置**或 `templateVarKey` 从变量读
> - 目标追踪：三者都有 `trackingEnabled`（命中后把命中框写回 `regionVarKey`，下次在目标周围局部搜索）

**VisionCondition**（sealed，`type` 判别）：

| type | 必填 | 关键参数 |
|---|---|---|
| `color_at` | x,y,color(ARGB Int) | tolerance=10、sampleRadius=0、sampleMode=CENTER/CROSS/SQUARE、**hitThreshold=1**、similarity=1f、colorVarKey、elementRef、preprocess |
| `color_region` | left,top,right,bottom,color | **colors:List<Int>（附加颜色，与主色并集判定）**、**colorVarKeys:List<String>（附加颜色「从变量读」，与 colors 平行，非空时该变量值覆盖对应位置颜色）**、**colorMatchMode=ANY/ALL/N_OF + requiredMatchCount + trackingEnabled（命中后写回 regionVarKey）**、matchMode=REGION_MATCH/FIND_TARGETS、tolerance=10、sampleStep=6、hitRatio=1f、requireAverageMatch=true、earlyAccept/earlyReject=true、similarity=1f、colorVarKey、elementRef、preprocess |
| `text_exists` | left,top,right,bottom,text | **texts:List<String>（附加文字，与主文字并集判定）+ textMatchMode=ANY/ALL/N_OF + requiredMatchCount + trackingEnabled**、regex=false、caseSensitive=true、minConfidence=0.6f、similarity=1f、textVarKey、regionVarKey、regionPaddingPx、elementRef、preprocess |
| `template_match` | templateBase64 | **templatePath（资源外置：模板图相对路径 `res/templates/` 下，非空时优先于 templateBase64 从项目文件读取）**、**templates:List<TemplateSpec>（附加模板，与主模板并集匹配）**、**templateMatchMode=ANY/ALL/N_OF + requiredMatchCount + trackingEnabled**、threshold=0.8f、method=CCOEFF_NORMED、scaleMode=AUTO/AUTO_MULTI、maxResults=1、templateVarKey（模板从变量读）、templateBaseScreenWidth/Height（模板基准分辨率，跨分辨率缩放用）、colorMode=GRAY/…、suppressRadius=8、pickWriteRegion=true |

区域类条件还支持 `regionPaddingPx`、`regionOffset{Left,Top,Right,Bottom}Px`、`leftPct/topPct/rightPct/bottomPct`（百分比优先）、`preprocess`(OcrPreprocess：filter=NONE/GAUSSIAN_BLUR/..., grayscale, threshold 等)。

### 3.6 NodeSelector（`node_*` 动作的 selector）

```json
{ "packageName": "com.xx", "viewId": "btn_start", "text": "开始", "textMode": "CONTAINS",
  "description": "", "descriptionMode": "CONTAINS", "className": "android.widget.Button",
  "clickable": true, "enabled": true, "visibleToUser": true, "depth": null, "indexInParent": null,
  "stablePath": null }
```

匹配：stablePath>viewId>packageName>text>description>className 权重打分取最优；`SelectorMatchMode: EXACT/CONTAINS/FUZZY`。

### 3.7 结果绑定（等待/视觉动作写变量）

- `NodeWaitResultBindings`（wait_node/check_node 的 `outputs`）：`matchedVar/existsVar/elapsedMsVar/pointVar("x,y")/boxVar("left,top,right,bottom")/textVar/classNameVar/viewIdVar`，全部 `""` 表示不写。
- `NodeInfoResultBindings`（get_node_info 的 `outputs`，P1-2）：`existsVar/matchedVar/textVar/descriptionVar/viewIdVar/classNameVar/packageNameVar/pointVar/boxVar/checkedVar/checkableVar/enabledVar/clickableVar/longClickableVar/focusableVar/focusedVar/scrollableVar/editableVar/selectedVar/visibleVar/depthVar/indexVar/stablePathVar`；节点不存在时仅写 exists/matched，其余不写。
- `VisionResultBindings`（视觉动作 `outputs`）：`matchedVar/hitCountVar/scoreVar/scoresVar/pointVar/pointsVar/boxVar/boxesVar/textVar/textsVar/allTextVar/**allTextFormat**/numberVar/numbersVar/messageVar`。
  - `allTextVar` = **范围内全部识别文本**；`allTextFormat=CONCAT_TEXT`（默认，所有行**直接拼接成一整段**，无分隔符）/ `RAW_INFO`（JSON 详情数组，含每段文本与文本框）。
- **视觉识别行为要点（写脚本必知）**：
  - **OCR 是「行级」匹配**：`text_exists` 对每个 OCR 识别行**独立判定**（关键词必须与该行内的目标内容同行才会命中）。不同厂商 OCR 的行切分不同（实测 OPPO 会把「距我」与数字拆到不同行）→ 需要跨行取值时，用 `allTextVar` 拿整段文本再用 `run_code`(JS) 自行解析，不要依赖行结构。
  - **命中行会自动提取数字**：`numbersVar` = 命中行内**全部数字**（正则 `-?\d+(?:\.\d+)?`，顺序保持）；`numberVar` = 首个数字。例：「全程4.16km」→ `[4.16]`；若「全程4.16km 距我25.29km」同在一行 → `[4.16, 25.29]`。
  - `regex=true` 时用正则匹配行文本（命中即 1.0 分，不受 `minConfidence` 影响）；正则模式下 `texts`/`allTextVar` 仍按行收集。
- **WaitNode 超时**：先写变量（matched=false）再抛软失败（不中断脚本）；CheckNode 单次检测无条件继续。

## 4. 变量引擎（`core/expression/`）

### 4.1 定义与作用域

- 定义：`set_var`/`inc_var` 节点内联；控制台可调参数用顶层 `consoleVariables`（`ConsoleVariableBinding`：`key` 必填、**`defaultValue` 是 String 类型（如 `"50"`，不是数字 50）**、`defaultScope="LOCAL"/"GLOBAL"`、`controlType=AUTO/TOGGLE/NUMBER/TEXT/SELECT/ARRAY`、`valueType`(字符串)、`minValue/maxValue/stepValue:Double?`、`options:List<ConsoleVariableOption{label,value}>`、`layoutMode=HORIZONTAL/VERTICAL`、`label`/`description`/`group`(面板展示)、`enabled`、`readOnly`、`order`）。
- 作用域：`LOCAL`（默认）/`GLOBAL`。读取是合并视图：**内置常量($前缀) < global < local**（local 覆盖同名）。子流程进入/返回自动快照恢复局部变量；子脚本（run_script）只继承 global。
- 面板变量播种：`defaultScope` 为空或 LOCAL 时按 GLOBAL 写入。
- 内置变量：`$SCRIPT_NAME/$SCRIPT_ID/$SCREEN_WIDTH/$SCREEN_HEIGHT/$BASE_SCREEN_WIDTH/$BASE_SCREEN_HEIGHT/$NOW_MS/$NOW_SEC/$NOW_DATE/$NOW_TIME/$DEVICE_MODEL/$DEVICE_BRAND/$ANDROID_VERSION/$ANDROID_SDK/$APP_VERSION`。

### 4.2 变量引用三种方式

1. **表达式内直接写变量名**：`重试次数 + 1`、`识别框数组[0]`（变量名支持中文/字母/下划线/数字，`$` 可开头，不能数字开头）。
2. **VarKey 字段直填**：所有 `*VarKey` 后缀字段（约 60 个，如 `millisVarKey/pointVarKey/durationVarKey/timeoutMsVarKey/inputTextVarKey`）非空时优先于固定值，支持变量名/索引/表达式。统一解析优先级（`resolveRuntimeField`）：`=`前缀显式表达式 → 表达式特征自动识别(`arr[0]`/`at(arr,i+1)`/`1+2`) → 变量直查 → 原字符串兜底。**求值失败自动回退**，旧脚本安全。
3. **Prompt 模板 `${...}`**：`${name}` 先变量直查再表达式；`${=表达式}` 强制表达式；支持 `${识别框数组[0]}`、`${=轮次 + 1}`。

### 4.3 SetVar 的 `value` 四形态 + 多变量 `items`

```json
{ "type": "set_var", "key": "count", "value": 42 }
{ "type": "set_var", "key": "总分", "value": { "kind": "expression", "expression": "number(金币) + number(银币)", "resultType": "NUMBER" } }
{ "type": "set_var", "key": "目标", "value": { "type": "TEXT", "selectedId": "b1", "items": [ { "id": "b1", "label": "确定", "value": "element://lib1/elem2" } ] } }
{ "type": "set_var", "key": "点数", "value": [1, 2, 3] }
```

- 字面量 / 表达式对象(`kind="expression"`) / 集合对象(VariableCollectionValue，运行值=选中项 value) / JSON 数组。
- `resultType`: `AUTO/NUMBER/BOOLEAN/TEXT/COORDINATE/ARRAY/NUMBER_ARRAY/BOOLEAN_ARRAY/TEXT_ARRAY/COORDINATE_ARRAY`。

**多变量 `items`（`set_var`/`inc_var`/`get_var` 三者都支持，S-变量操作多变量）**：`items: List<VariableItem>` **非空时逐条执行，且优先于单条 key/value**（单条格式保留兼容）。条目 `type` 为空时回退宿主节点类型；**非空时以条目为准 → 可在同一节点里混用 set/inc/get**。

```json
{ "type": "set_var", "key": "", "value": "", "items": [
    { "type": "set", "key": "计数", "value": 0, "scope": "LOCAL" },
    { "type": "set", "key": "总分", "value": { "kind": "expression", "expression": "轮次 + 1", "resultType": "NUMBER" } },
    { "type": "inc", "key": "轮次", "delta": 1 }
] }
{ "type": "inc_var", "key": "", "items": [ { "key": "计数", "delta": 1 }, { "key": "总分", "delta": 10 } ] }
{ "type": "get_var", "sourceKey": "", "targetKey": "", "items": [ { "type": "get", "sourceKey": "全局配置", "key": "本地配置", "scope": "LOCAL" } ] }
```

- `VariableItem` 字段：`type`(`set`/`inc`/`get`，可省)、`key`、`value`(JsonElement，SET 用)、`delta`(INC 用，默认 1.0)、`sourceKey`(GET 用)、`scope`(默认 LOCAL)。
- ⚠️ **宿主节点的 `key`/`value`（GetVar 为 `sourceKey`/`targetKey`）在模型里无默认值 → 用 items 时也必须带上（留空串占位如 `"key":""`），否则严格反序列化（`.axs` 导入）会报缺字段**；它们会被忽略，实际执行以 items 为准。

### 4.4 表达式语法（VariableExpressionEngine）

- 字面量：数字、文本（单/双引号）、`true/false/null`、`PI/TAU/E`、数组 `[1,2,3]`、坐标文本 `"x,y"`、区域文本 `"left,top,right,bottom"` 自动识别。
- 运算符（优先级从高到低）：括号/索引 → 一元 `! -` → `* / %` → `+ -` → `< <= > >=` → `== !=` → `&&` → `||`。
  - `+`：数字相加；任一侧文本→字符串拼接；任一侧数组→拼接/追加。
  - `==`：数字误差容忍、数组逐项、坐标容差。
  - **无三元**，用 `if(cond, a, b)`。
- 索引：`arr[0]`、`arr[-1]`（负索引从末尾数，越界抛错）；`at(arr, i)` 等价。
- 全角自动归一化：`＋－×÷（）［］，＝＜＞！＆｜＇＂　` 及全角数字自动转半角（字符串字面量内部保留）。

**内置函数全集**（省略括号即参数列表）：

| 分组 | 函数 |
|---|---|
| 基础数学 | `abs min max round floor ceil clamp sqrt pow exp log log10 hypot` |
| 三角 | `sin cos tan asin acos atan atan2 sinDeg cosDeg tanDeg asinDeg acosDeg atanDeg atan2Deg radians degrees` |
| 聚合 | `sum avg count len` |
| 数组/文本 | `first last at contains join split concat slice reverse unique sort sortByScore array` |
| 多目标筛选 | `bestIndex bestPoint bestRect nearestPoint nearestRect leftPoint rightPoint topPoint bottomPoint leftRect rightRect topRect bottomRect largestRect sortPointsByX sortPointsByY sortRectsByX sortRectsByY sortRectsByArea dedupePoints dedupeRects stablePoint stableRect` |
| 类型转换 | `number text bool extractNumber array numbers texts bools coords point` |
| 坐标/向量 | `x y rectLeft rectTop rectRight rectBottom rectWidth rectHeight rectCenter offset dx dy distance midpoint angle angleRad project vector length magnitude normalize dot cross heading headingRad between pointInRect pointInCircle lerp lerpPoint remap` |
| 文本 | `trim upper lower replace startsWith endsWith` |
| 正则/JSON（P0-3） | `regexMatch(text,pattern)`、`regexExtract(text,pattern,group=0)`、`regexReplace(text,pattern,repl)`、`jsonGet(json,"a.b[0].c")`（宽松解析，null→null 值） |
| 逻辑 | `if(cond,a,b) coalesce(...)` |
| 随机 | `random() random(lo,hi) randInt(lo,hi) randFloat(lo,hi) chance(p) randomChoice(...) shuffle(...) sample(arr,n)` |
| 动态变量 | `var(name) get(name)` 按字符串名读变量 |

常用写法：`number(重试次数)+1`、`extractNumber(replace(trim(金币文本),",",""))`、`rectCenter(bestRect(识别框数组,置信度数组))`、`if(是否战斗, 战斗坐标, 巡逻坐标)`、`get("目标"+text(当前序号))`。

### 4.5 变量条件（VarCondition / WhileVar / VarSwitch）

```json
{ "type": "if", "varCondition": { "mode": "COMPARE", "key": "retry", "op": "LT", "value": "5" },
  "thenBlock": { "nodes": [] }, "elseBlock": { "nodes": [] } }
{ "type": "while_var", "key": "retry", "op": "LT", "value": 5, "block": { "nodes": [] }, "maxIterations": 10000 }
```

- COMPARE 按变量实际类型匹配：**布尔只支持 EQ/NE；数字支持全部 6 算子；文本只支持 EQ/NE**；变量不存在→false。
- EXPRESSION 模式：`"mode":"EXPRESSION","expression":"number(血量)>=50 && 是否战斗"`，求值失败→false。

## 5. 执行引擎语义（决定脚本怎么跑）

### 5.1 启动与生命周期

- 运行前 `ScriptValidator.validate` 静态校验，**任何 ERROR 级问题直接拒绝执行**（见第 7 节清单）。
- `settings.runCount` 轮次主循环；`runCount=0` 无限循环（脚本级）。每轮跑完 `root` 后等待全部异步事件 Job 完成。
- 停止/暂停/来电自动暂停均由 ExecutionManager 统一处理；脚本内用 `run_control`（PAUSE/STOP）控制。
- 运行结束时：正常=SUCCESS；用户停止或 STOP 策略=CANCELLED；其它异常=FAILED（`pauseOnRuntimeError=true` 时暂停等待人工恢复）。

### 5.2 动作执行与失败语义

- 每个动作有独立执行管线：运行条件 → preDelay → 执行（包 timeoutMs）→ 成功/失败策略 → postDelay；外层 repeat 循环；handler 内部 retry。
- **软失败** `ActionSoftFailException`（如 wait_node 超时、node_click 找不到节点、wait_for_vision 未命中）：转失败策略处理，**脚本不中断**。
- **硬失败**（IllegalStateException 等：子流程递归、while 超 maxIterations、IncVar 非数字、表达式失败）：直接 FAILED 冒泡。
- `try_catch` 只捕获"失败策略为 CONTINUE/RETRY 时转成的 TryCatchAbortException"——**普通异常不进 catch**。
- BlockResult：`Normal` 继续；`BreakRepeat`/`ContinueRepeat` 只被最近一层循环消费；`Jump` 向上冒泡找 label。**`if` 不消费 break/continue**。

### 5.3 运行需求（脚本运行时 App 会检查）

| 需求 | 触发条件 |
|---|---|
| 无障碍服务 | 输入后端=ACCESSIBILITY，或脚本含 `node_*`/`find_and_*`/`scroll_to_find`/`wait_node` 等节点查找动作 |
| 悬浮窗权限+服务 | 弹窗/提示/虚拟控件/运行日志展示需要 |
| 屏幕捕获(MediaProjection) | 任何视觉动作（`*vision*`、click_color/text/image、scroll_until_vision） |
| AI 截图外发确认 | `ai_vision`/`ai_reply`（视觉模式）首次会弹"是否同意截图外发"，拒绝则该次 AI 视觉未命中（软失败不中断） |
| Shizuku | 输入后端=SHIZUKU（纯坐标注入不需要无障碍） |
| root sendevent | 输入后端=SENDEVENT（root 并行注入，真人可同时操作） |

写脚本时在交付说明里告诉用户需要开哪些权限。

### 5.4 事件监听（event_listener）

- 顶层节点放 `event_listener`（只定义不顺序执行），`eventName` 用逗号/换行/分号分隔多个事件。
- 事件名触发时机（动作生命周期）：`onStart`/`onConditionSuccess`/`onConditionNotSuccess`/`onSuccess`/`onFail`/`onTimeout`/`onRetry`/`onFinish`。
- `targetType`：`SUB_FLOW`(执行子流程，async 默认 true 独立协程) / `LABEL`(跳转) / `ACTION`(执行目标节点) / `INLINE_ACTION`(内联动作) / `VARIABLE`(仅 SetVar/IncVar)。
- `writeEventToVars=true` 时写 `event_name/event_action/event_reason` 三个变量（其中 `event_reason` 写**中文说明**，如「未命中（没识别到图片/文字/颜色）」，不是内部标记）。

**系统事件源（`source`，默认 `SCRIPT`）**

除脚本事件外，还能监听**手机系统事件**。`source` 取值、事件名与所需权限：

| source | 事件名 | 触发时机 | 需要权限 |
|---|---|---|---|
| `SCRIPT`（默认） | `onStart`/`onSuccess`/`onFail`/`onTimeout`/`onRetry`/`onConditionSuccess`/`onConditionNotSuccess`/`onFinish` | 脚本内动作生命周期 | 无 |
| `NOTIFICATION` | `onNotification` | 收到通知 | 「通知使用权」 |
| `WINDOW` | `onWindowChanged`（切换界面）/ `onContentChanged`（内容更新，**触发很频繁**） | 无障碍界面变化 | 无障碍服务 |
| `SCREEN` | `onScreenOn` / `onScreenOff` / `onUserPresent`（解锁） | 屏幕状态变化 | 无 |
| `CALL` | `onCallIncoming` | 来电 | **尚未开放** |

配套过滤字段（留空 = 不限制；系统事件很泛，**建议至少配一项**，否则会被噪音频繁触发）：

```json
{ "type": "event_listener",
  "eventName": "onNotification",
  "source": "NOTIFICATION",
  "filterPackage": "com.tencent.mm",
  "filterTitleContains": "",
  "filterTextContains": "验证码",
  "filterClassName": "",
  "targetType": "SUB_FLOW", "targetSubFlow": "处理通知",
  "async": true, "writeEventToVars": true }
```

- 字段含义：`filterPackage` 限定来源应用（多个用逗号分隔）；`filterTitleContains` 通知标题包含；`filterTextContains` 通知内容 / 界面文字包含；`filterClassName` 界面类名包含（仅 `WINDOW` 源）。
- **权限未授权不会静默失效**：脚本启动时运行日志会打明确提示（写明"该监听不会生效"与开启路径），属性面板也会显示提示条、可点击直达系统设置。
- 系统事件同样写事件变量（`writeEventToVars=true`），`event_reason` 为该来源的中文名（如「通知到达」）。
- 仅当脚本里真的存在 `source != SCRIPT` 的监听器时才注册系统监听，脚本结束即注销（不留常驻开销）。

### 5.5 run_code 的 JS 环境（Rhino）

JS 内可用 `runtime.*` 命名空间（**以源码 `RunCodeHandler.kt` 注册为准，下表已逐一核对**）：

| 命名空间 | 方法 |
|---|---|
| `runtime.variables` | `get(key)` / `set(key, value)` / `remove(key)` / `keys()` |
| `runtime.touch` | `tap(x,y,dur)` `multiTap(x,y,count,intervalMs)` `touchDown(x,y,pointerId,holdMs)` `touchUp(pointerId)` `movePointer(x,y,pointerId,dur,pathType)` `swipe(x1,y1,x2,y2,dur)` `dragToTarget(x1,y1,x2,y2,dur)` `longPress(x,y,ms)` `scrollToFind(text,maxScrolls)` `findAndClick(text)` `singleTouch(x,y)` `findAndInput(text,description)` `sleep(ms)` |
| `runtime.vision` | `textExists(text,left,top,right,bottom)` `waitForText(text,timeoutMs,left,top,right,bottom)` `waitForTextGone(...)` `imageExists(base64,threshold)` `clickText(text,left,top,right,bottom)` `clickImage(base64,threshold,left,top,right,bottom)` `waitForImage(base64,timeoutMs,threshold)` `imageGone(...)` `colorAt(x,y,timeoutMs,tolerance)` `clickColor(x,y,timeoutMs,tolerance)` `colorRegion(left,top,right,bottom,color,tolerance,ratio)` `waitForColor(x,y,timeoutMs,tolerance)` `checkVision()` |
| `runtime.nodes` | `focus(selector)` `swipe(selector,direction,ratio,dur)` `setChecked(selector,bool)` `waitFor(selector,timeoutMs)` `click(selector)` `exists(selector)` `input(selector,text)` `clearInput(selector)` `doubleClick(selector,intervalMs)` `dumpHierarchy()` |
| `runtime.system` | `globalAction("BACK")` `back()` `home()` `recents()` `openApp(pkg)` `openLink(uri)` `runScript(id)` `runControl(control)` |
| `runtime.screen` | `isOn()` `isLocked()` `width()` `height()` `androidVersion()` `deviceModel()` `capture()` `wakeUp(ms)` |
| `runtime.network` | `request(method,url,headers,body,timeoutMs,retry)` `getText(url,timeoutMs,retry)` `postText(url,body,timeoutMs,retry)` `getBytes(...)` `getTextWithHeaders(...)` `getBytesWithHeaders(...)` |
| `runtime.files` | `read(path)` `write(path,content)` `append(path,content)` `delete(path)` `exists(path)` `listDir(path)` `size(path)` `lastModified(path)` `stat(path)` `writeBytes(path,base64)` `readBytes(path)` |
| `runtime.process` | `log(msg)` `warn(msg)` `error(msg)` `stop(reason?)` `pause()` |
| `runtime.crypto` | `md5(s)` `sha256(s)` `hmacSha256(s,key)` `base64Encode(s)` `base64Decode(s)` |
| `runtime.cookies` | `setCookie(url,cookieString)` `getCookie(url)` `clearCookies()` —— **⚠️ 首参是 URL**（如 `https://mtop.damai.cn/`），不是 cookie 名；`setCookie` 传入 `"k=v; k2=v2"` 形式的整串 |
| 全局 `console` | `log(msg)` `warn(msg)` `error(msg)` |

> ⚠️ **命名踩坑（早期文档写错过）**：是 `variables`/`screen`/`nodes`/`network`/`files`，**不是** `vars`/`sys`/`node`/`net`/`file`；`findAndInput` 在 `touch` 命名空间，不在 `nodes`。

**JS 桥接边界（写 run_code 前必读）**：
- **JS 数组可直接存成变量数组**（S1452 已落地）：`runtime.variables.set` 入口自动把 Rhino `NativeArray` 递归转成 Kotlin `List`，表达式侧可直接 `题库[i]` 索引、`len(题库)`、`contains`；JS 对象（Scriptable）兜底转文本。旧脚本的 `join(分隔符)` + `split` 技巧仍兼容。
- `runtime.variables.set` 写 **LOCAL** 作用域（子流程内返回后回滚）。
- 表达式字符串字面量**不支持 `\uXXXX` 转义**（反斜杠被剥掉），分隔符请用可见字符（如 `|`）。
- JS 执行有 `timeoutMs`（默认 30000）；异常包装成 `{name, message}` 对象（不会崩 JavaMembers）。结果可用 `bindResultToVar` 写回变量（转字符串）。

### 5.6 虚拟控件（virtualControls + virtualControlSchemes）

```json
{ "virtualControls": [
  { "type": "button", "id": "vb1", "action": { "type": "virtual_button",
      "controlId": "vb1", "displayName": "攻击", "triggerVarKey": "攻击中", "triggerMode": "EDGE",
      "pressType": "TAP", "x": 900, "y": 2000, "xPct": 0.83, "yPct": 0.83 } }
] }
```

- `virtual_button`：`triggerMode=EDGE`(false→true 边沿触发一次，cooldownMs=300)/`HOLD`(true 按住 false 松开)；`pressType=TAP/LONG_PRESS/SWIPE`；用变量 `triggerVarKey` 布尔驱动。
- `virtual_joystick`：`targetPointVarKey`（目标坐标变量）、`referenceMode=SCREEN_CENTER/STATIC_POINT/VARIABLE_POINT`、`deadZonePx=24`、`joystickRadiusPx=180`、`smoothFactor=0.35f`、`updateIntervalMs=80`、`releaseDelayMs=120`。
- 布局方案 `virtualControlSchemes`：`{id,name,scope=NORMAL/GLOBAL,items:[{controlId,xPct,yPct,swipeToXPct,swipeToYPct,sizeScale,visible}]}`；运行中可 `switch_virtual_control_scheme` 切换。
- 坐标解析优先级：布局方案覆盖 → pointVarKey 变量 → 静态布局点。

## 6. 常用设计模式

1. **等节点再点**（最稳）：`wait_node`（写 matched 变量）→ `if` 变量条件 → `node_click` / 失败处理。超时软失败不中断，可配 `retryTimes=-1` 或失败策略 GOTO 重试标签。
2. **固定次数重试循环**：`repeat`(times=N) + `wait_node` + `break`（找到就 break）+ `if` 检查；找不到走 else 分支。
3. **刷资源循环**：`while_var`(key=次数, LT, N) + `swipe` + `wait_for_vision` + `click_image` 收菜；视觉命中写 `outputs` 变量再 `if` 判断。
4. **用户可调参数**：`consoleVariables` 面板变量（数字/开关/选择/数组），动作里用 `*VarKey` 或表达式引用。
5. **复杂流程拆子流程**：`subflow_def` 定义 + `call_subflow` 调用（局部变量隔离，天然防变量污染）；错误兜底用 `try_catch`。
6. **事件驱动**：动作 `config.events.onFail` 绑子流程做异常上报/告警；全局 `event_listener` 监听某动作成功事件跳转。
7. **虚拟控件做挂机**：`virtual_button` + `triggerVarKey` 变量（由 `run_code`/变量面板驱动）或 `trigger_virtual_button` 动作直接触发。
8. **防检测**：`config.coordJitterMinPx/MaxPx` 加随机抖动；`preDelayRandomRangeMs` 随机前置延迟。

## 7. 交付自查清单（对 ScriptValidator 规则逐项）

- [ ] 节点树完整闭合：每个 `if`/`repeat`/`while_*`/`try_catch`/`race`/`subflow_def`/`var_switch` 都有 block，`block.nodes` 存在（可空数组）。
- [ ] `repeat.times > 0`（校验器强制）；`intervalMillis >= 0`。
- [ ] `while_var.maxIterations` / `while_vision.maxIterations` / `while_vision.timeoutMillis` 护栏在，防止死循环（默认 10000 即可）。
- [ ] `goto.target` 与 `event_listener`/`run_control` 引用的 label/节点 id/子流程 name 都存在（最近作用域优先，支持向上冒泡；**不能跳进子块/子流程内部**）。
- [ ] `touch_down` 的 pointerId 有对应 `touch_up`（`move_pointer.touchDownRefId` 引用存在），避免卡指。
- [ ] 变量引用（表达式里的名字、VarKey 值、VarCondition.key）要么已定义、要么来自 `outputs` 绑定/面板变量；`scope` 只用 `LOCAL`/`GLOBAL`。
- [ ] 条件项枚举拼写正确：`op`=LT/LE/EQ/NE/GE/GT；`action_run_status.status`=success/failure/not_run；`run_count_limit.resetMode`=loop_end/script_end/script_open。
- [ ] 坐标双写：像素 `x/y` + 百分比 `xPct/yPct`（0~1 之间）；区域 `left/top/right/bottom` + `leftPct/topPct/rightPct/bottomPct`；虚拟控件给 `xPct/yPct`；**单指/多指要逐 pathNode 双写，`multi_tap`/`long_press`/`swipe`/`move_pointer`/`drag_to_target` 同理**。
- [ ] 运行需求齐备：有节点查找 → 提示无障碍；有视觉 → 提示屏幕录制；纯坐标可提示 Shizuku/root 可选。
- [ ] `event_listener` 的 `async=true` 时目标非 LABEL；监听器不要自环指向自身（校验器会查）。
- [ ] `run_code` 的 JS 只调上表命名空间（`runtime.variables/touch/vision/nodes/system/screen/network/files/process/crypto/cookies` 与全局 `console`）；**命名不是 `vars`/`sys`/`node`/`net`/`file`**；`http_request`/`file_action`/AI 视觉等一次性授权动作注意运行时授权弹窗。
- [ ] JS 数组可直接 `runtime.variables.set`（S1452 已自动转 List），JS 对象会转文本；子流程内 JS 写变量默认 LOCAL（返回回滚），跨子流程回传用 GLOBAL。
- [ ] 已知误报：运行时校验器的「表达式引用了未定义变量」不识别 `run_code` 动态 set 的变量、「变量重复定义」不识别循环内有意重置——均为警告不影响执行，可忽略。
- [ ] 布尔变量只用 EQ/NE 比较；文本变量只用 EQ/NE；数字变量才能用 LT/GE 等。
- [ ] JSON 合法：`"type"` 字段值必须与上表完全一致（含大小写与下划线）。
- [ ] **字段类型与模型一致**（`.axs` 导入走严格模式，无 lenient/coerce）：`consoleVariables[].defaultValue` 是 **String**（数字要写 `"50"`）；`minValue/maxValue/stepValue` 是 Double；`valueType` 是字符串；`baseScreenWidth/Height` 是 Int。粘贴对话框(lenient)能容错不代表 `.axs` 导入能过。

## 8. 明确不存在的写法（避免幻觉）

- ❌ `{{变量}}` / `${var}` 通用占位（只有 Prompt 的 `${...}` 模板）。
- ❌ 三元 `a ? b : c`（用 `if(a,b,c)`）。
- ❌ 数组原地写 `arr[0]=x` / `arr.push(x)`（整体重建后 SetVar，追加用 `数组 + 值` / `concat` / `array(...)`）。
- ❌ `Repeat.times <= 0` / 循环 `break` 出 `if`。
- ❌ `single_touch`/`multi_touch` 写旧字段 `points`（虽能靠读时迁移导入，但新脚本一律用 `pathNodes`）；写了 `pathNodes` 却只给像素 `x/y` 不给 `xPct/yPct`（能跑，但换分辨率就偏，校验器会警告）。
- ❌ 不存在的动作/节点 `type`（上表之外的一律没有，如 `keyboard`/`sound`/`vibrate` 动作——vibrate 只存在于 Prompt 的 `vibrate` 布尔字段）。
- ❌ 期望普通异常被 `try_catch` 捕获（只捕获 TryCatchAbortException 语义路径）。
- ❌ 在 JS 里访问 Android 类（Rhino 无 JavaMembers 支持，会 NoClassDefFoundError——只能用 `runtime.*`）。
- ❌ `open_app` 之外的任意包名启动方式（没有 intent 动作）。

## 附：快速索引（仅源码持有者可选，用于复核/校准）

> 使用者不需要读源码——本文档 §3~§5 已内嵌全部字段与语义。以下路径仅本项目（WeMod 主仓）维护者在版本升级后复核时参考。

| 主题 | 文件 |
|---|---|
| 节点/动作/配置全字段 | `script-runtime/src/main/kotlin/com/wemod/automation/model/ActionNode.kt`、`ScriptAction.kt`、`ActionConfig.kt` |
| 表达式函数实现 | `core/expression/VariableExpressionEngine.kt`、`VariableExpressionParser.kt` |
| 字段解析优先级 | `core/execution/handlers/ActionRuntimeFieldResolver.kt`、`ActionVariableResolvers.kt` |
| 执行语义 | `core/execution/executor/ScriptActionExecutor*Runtime.kt`、`core/execution/ExecutionContext.kt` |
| 校验规则 | `core/execution/validator/ScriptValidatorNodeTraversal.kt`、`ScriptValidatorConditionChecks.kt` |
| 运行需求 | `core/execution/ScriptRunRequirements.kt` |
| 历史设计依据 | `docs/方案/S1412_方案_变量局部全局作用域语义落地.md`、`docs/分析/S1402_分析_等待节点动作结果写入变量能力对齐.md` |
