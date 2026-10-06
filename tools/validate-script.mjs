#!/usr/bin/env node
/**
 * WeMod 脚本离线校验器（独立工具，不依赖 Android/Kotlin 环境）
 *
 * 用法：
 *   node validate-script.mjs <脚本文件.axs|.json> [--strict]
 *
 * 校验内容：
 *   1. JSON 语法
 *   2. Script 顶层必填字段
 *   3. 节点/动作 type 白名单 + 必填字段
 *   4. 枚举值白名单（scope/op/matchMode/策略/条件 type 等）
 *   5. 引用完整性（goto→label/节点id、call_subflow→subflow_def、touch_down 引用）
 *   6. consoleVariables 类型（defaultValue 必须是字符串——.axs 导入走严格 Json 的常见坑）
 *   7. 关键字段类型抽查（repeat.times 数字、坐标双写提示）
 *
 * 注意：此工具是"预检"，最终以 App 内 ScriptValidator 为准。
 * 数据依据 script-runtime 模型快照（2026-08-17，S1440/S1441）。
 */

import { readFileSync } from 'node:fs';

/* ============ 数据（模型快照） ============ */

const NODE_TYPES = new Set([
  'action', 'if', 'var_switch', 'repeat', 'block', 'try_catch', 'race',
  'subflow_def', 'call_subflow', 'event_listener', 'label', 'goto',
  'set_var', 'inc_var', 'get_var', 'while_var', 'while_vision',
  'break', 'continue',
]);

const ACTION_TYPES = new Set([
  'delay', 'tap', 'multi_tap', 'touch_down', 'touch_up', 'move_pointer',
  'drag_to_target', 'long_press', 'swipe', 'single_touch', 'multi_touch',
  'click_color', 'click_text', 'click_image', 'find_and_click',
  'find_and_input', 'scroll_to_find', 'node_click', 'node_double_click',
  'node_long_press', 'node_input', 'wait_node', 'check_node', 'get_node_info',
  'node_clear_input', 'node_focus', 'node_set_checked', 'node_swipe',
  'no_control_input', 'scroll_until_vision', 'ensure_screen_on',
  'take_screenshot', 'key_event', 'shell_command', 'run_code', 'http_request', 'file_action',
  'global_action', 'open_app', 'open_link', 'prompt', 'run_control',
  'run_script', 'switch_virtual_control_scheme', 'trigger_virtual_button',
  'wait_for_vision', 'check_vision', 'virtual_button', 'virtual_joystick',
  'ai_vision', 'ai_reply', 'ai_agent',
]);

const VISION_TYPES = new Set(['color_at', 'color_region', 'text_exists', 'template_match']);

/** 颜色命中规则（ColorMatchMode，多点比色/找色与颜色集合共用） */
const COLOR_MATCH_MODES = new Set(['ANY', 'ALL', 'N_OF']);

/** 颜色区域匹配模式（ColorRegionMatchMode）：FIND_TARGETS + points 非空 = 多点找色 */
const COLOR_REGION_MATCH_MODES = new Set(['REGION_MATCH', 'FIND_TARGETS']);

/** 找色扫描/返回方向（ColorFindDirection） */
const COLOR_FIND_DIRECTIONS = new Set(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']);
const CONDITION_ITEM_TYPES = new Set([
  'vision', 'time', 'variable', 'expression', 'action_run_status',
  'screen_on', 'screen_locked', 'node', 'run_count_limit',
]);
const COMPARE_OPS = new Set(['LT', 'LE', 'EQ', 'NE', 'GE', 'GT']);
const SCOPES = new Set(['LOCAL', 'GLOBAL']);
const OUTCOME_STRATEGIES = new Set(['CONTINUE', 'STOP', 'RETRY', 'GOTO']);
const OUTCOME_TARGET_TYPES = new Set(['LABEL', 'SUB_FLOW', 'ACTION']);
const CONSOLE_CONTROL_TYPES = new Set(['AUTO', 'TOGGLE', 'NUMBER', 'TEXT', 'SELECT', 'MULTI_SELECT', 'ARRAY']);
const PROMPT_DISPLAY_TYPES = new Set(['DIALOG', 'SIMPLE', 'NOTIFICATION']);

/* ============ 弹窗控件与通用字段类型校验（S-事件源-25） ============
 * 背景（真实案例）：内置示例 prompt_form.axs 的 button.binding 写成了空串 ""，
 * 而模型是 ActionEventBinding?（对象或 null）⇒ App 端 decodeScript 抛异常 ⇒ 导入**静默失败**；
 * 旧版校验器对 prompt.controls 完全没有校验（checkAction 里没有 prompt 分支），漏掉了这类致命错误。
 * 因此补两层：
 *   1) PROMPT_CONTROL_*：按 PromptControl 模型校验控件类型与字段值类型；
 *   2) ACTION_FIELD_TYPES：通用「值类型 ≠ 模型类型」扫描（对象 / 数组 / 数字 / 布尔）。
 * 局限：离线近似校验，字段表只覆盖已核实的高危字段（逐步扩表）；最终以 App 内 ScriptValidator 与 kotlinx.serialization 为准。
 */
const PROMPT_CONTROL_TYPES = new Set(['button', 'input', 'switch', 'slider', 'checkbox']);
const PROMPT_BUTTON_STYLES = new Set(['FILLED', 'TONAL', 'OUTLINED', 'TEXT']);
const PROMPT_INPUT_PICK_MODES = new Set(['NONE', 'COORDINATE', 'COLOR', 'REGION', 'IMAGE']);

/** 枚举名字 → 实际 Set（供字段表里的 "enum:XXX" 伪类型解析，避免使用 eval） */
const ENUM_SETS = {
  PROMPT_DISPLAY_TYPES,
  PROMPT_BUTTON_STYLES,
  PROMPT_INPUT_PICK_MODES,
};

/** 弹窗控件字段 → 期望类型（一一对应 PromptControl 模型的五个子类） */
const PROMPT_CONTROL_FIELDS = {
  button: { text: 'string', style: 'enum:PROMPT_BUTTON_STYLES', binding: 'objectOrNull' },
  input: {
    label: 'string',
    targetVariable: 'string',
    hint: 'string',
    pickMode: 'enum:PROMPT_INPUT_PICK_MODES',
  },
  switch: { label: 'string', targetVariable: 'string', default: 'boolean' },
  slider: {
    label: 'string',
    targetVariable: 'string',
    min: 'number',
    max: 'number',
    step: 'number',
    default: 'numberOrNull',
  },
  checkbox: { label: 'string', targetVariable: 'string', default: 'boolean' },
};

/**
 * 通用字段类型表：动作 type → { 字段: 期望类型 }。
 * 只列"写错会直接导致 App 端反序列化失败或行为异常"的高危字段（已对照模型核实），
 * 不追求覆盖全部字段（那等于把模型重写一遍）；新增模型字段时按需扩表即可。
 */
const ACTION_FIELD_TYPES = {
  prompt: {
    title: 'string',
    content: 'string',
    controls: 'array',
    displayType: 'enum:PROMPT_DISPLAY_TYPES',
    position: 'string',
    vibrate: 'boolean',
  },
  delay: { millis: 'number' },
  tap: { x: 'number', y: 'number', duration: 'number' },
  run_code: { code: 'string' },
  // 单指/多指（S-触控-路径-1 修订）：触点是对象 / 触点数组，写成数组或字符串是导入级错误
  single_touch: { pointer: 'object' },
  multi_touch: { pointers: 'array' },
};

/** 动作必填字段（无默认值字段） */
const ACTION_REQUIRED = {
  delay: ['millis'],
  tap: ['x', 'y'], long_press: ['x', 'y'], touch_down: ['x', 'y'],
  swipe: ['fromX', 'fromY', 'toX', 'toY'],
  node_click: ['selector'], node_double_click: ['selector'],
  node_long_press: ['selector'], node_input: ['selector', 'inputText'],
  wait_node: ['selector'], check_node: ['selector'], get_node_info: ['selector'],
  node_clear_input: ['selector'], node_focus: ['selector'],
  node_set_checked: ['selector'], node_swipe: ['selector'],
  no_control_input: ['inputText'],
  click_color: ['condition'], click_text: ['condition'], click_image: ['condition'],
  wait_for_vision: ['condition'], check_vision: ['condition'], scroll_until_vision: ['condition'],
  open_app: ['packageName'], open_link: ['uri'], run_script: ['scriptId'],
  global_action: ['action'], http_request: ['url'],
  single_touch: ['pointer'], multi_touch: ['pointers'],
  drag_to_target: ['startX', 'startY'], multi_tap: ['x', 'y'],
};

/** 触点路径类型（与 ScriptAction.TouchPathType 对齐） */
const TOUCH_PATH_TYPES = new Set(['POINT', 'LINE', 'POLYLINE', 'RECORD', 'CURVE']);

/** 触点路径节点来源（与 ScriptAction.TouchTargetSourceType 对齐） */
const TOUCH_TARGET_SOURCE_TYPES = new Set([
  'COORDINATE', 'VARIABLE', 'IMAGE', 'TEXT', 'NODE', 'COLOR', 'TOUCH_DOWN',
]);

/**
 * 坐标双写提示表：动作 type → [[像素字段, 百分比字段], ...]。
 *
 * 依据：模型里像素与百分比并存，`ScreenCoordinateUtils.resolveX/Y` 在 `xPct ∈ 0..1` 时
 * **优先**按「百分比 × 当前屏幕」，否则回退像素值。只写像素不会报错，但换分辨率会失稳，
 * 所以统一给警告、不做阻断。单指/多指走 [checkTouchPointer]（逐 pathNode 判定）。
 */
const COORD_DOUBLE_WRITE = {
  tap: [['x', 'xPct'], ['y', 'yPct']],
  multi_tap: [['x', 'xPct'], ['y', 'yPct']],
  long_press: [['x', 'xPct'], ['y', 'yPct']],
  touch_down: [['x', 'xPct'], ['y', 'yPct']],
  move_pointer: [['x', 'xPct'], ['y', 'yPct']],
  swipe: [['fromX', 'fromXPct'], ['fromY', 'fromYPct'], ['toX', 'toXPct'], ['toY', 'toYPct']],
  drag_to_target: [
    ['startX', 'startXPct'], ['startY', 'startYPct'],
    ['targetX', 'targetXPct'], ['targetY', 'targetYPct'],
  ],
};

/** 节点必填字段 */
const NODE_REQUIRED = {
  action: ['action'],
  if: [], // conditions/thenBlock/elseBlock 均有默认，不强校验
  var_switch: ['key', 'cases'],
  repeat: ['times', 'block'], // times 必填（无默认值）——S1440 踩坑
  block: ['block'],
  try_catch: ['tryBlock', 'catchBlock'],
  race: ['leftBlock', 'rightBlock'],
  subflow_def: ['name', 'block'],
  call_subflow: ['targetName'],
  event_listener: ['eventName'],
  label: ['name'],
  goto: ['target'],
  set_var: ['key', 'value'],
  inc_var: ['key'],
  get_var: ['sourceKey', 'targetKey'],
  while_var: ['key', 'op', 'block'],
  while_vision: ['condition', 'block'],
  break: [], continue: [],
};

/* ============ 校验器 ============ */

const errors = [];
const warnings = [];
/** 提示（不计入警告数、不影响退出码）：见 [info] */
const notes = [];
const labelNames = new Set();
/** 结构容器内部（if/循环/trycatch 等分支块内）的标签——引擎仅支持同结构内本层跳转，跨层跳入会失效 */
const structuralLabels = new Set();
const nodeIds = new Set();
const subflowNames = new Set();
const touchDownRefs = new Set();

function error(msg, path) {
  errors.push(`${path ? '[' + path + '] ' : ''}${msg}`);
}
function warn(msg, path) {
  warnings.push(`${path ? '[' + path + '] ' : ''}${msg}`);
}

/**
 * 提示（`ℹ`）：不写也能跑、但会让某项能力用不了的提醒 —— 不计入警告数、不影响退出码。
 * 目前用于"未填作者 uid ⇒ 导入后无法发布到社区"（见 SKILL.md §2.3）。
 */
function info(msg, path) {
  notes.push(`${path ? '[' + path + '] ' : ''}${msg}`);
}
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function has(obj, k) { return obj[k] !== undefined && obj[k] !== null; }

function checkEnum(value, allowed, label, path) {
  if (value !== undefined && value !== null && !allowed.has(value)) {
    error(`枚举值 "${value}" 非法（允许：${[...allowed].join('/')}），字段 ${label}`, path);
  }
}

/** 校验 VisionCondition */
function checkVisionCondition(cond, path) {
  if (!isObj(cond)) { error(`视觉条件必须是对象`, path); return; }
  const type = cond.type;
  if (!VISION_TYPES.has(type)) { error(`视觉条件 type "${type}" 非法`, path); return; }
  if (type === 'color_at') {
    for (const f of ['x', 'y', 'color']) if (!has(cond, f)) error(`color_at 缺少必填字段 ${f}`, path);
    // 多点比色（S-手势面板-5T12）：color_at 没有 colorMatchMode，采样点规则用 pointsMatchMode + requiredMatchCount
    checkEnum(cond.pointsMatchMode, COLOR_MATCH_MODES, 'pointsMatchMode', path);
    checkColorAtPoints(cond.points, path);
    checkPointsRequiredCount(cond, path, 'requiredMatchCount', Array.isArray(cond.points) ? cond.points.length : 0);
  } else if (type === 'color_region') {
    for (const f of ['left', 'top', 'right', 'bottom', 'color']) if (!has(cond, f)) error(`color_region 缺少必填字段 ${f}`, path);
    checkEnum(cond.colorMatchMode, COLOR_MATCH_MODES, 'colorMatchMode', path);
    // 多点找色（S-手势面板-5T24）：matchMode=FIND_TARGETS 且 points 非空才进入
    checkEnum(cond.matchMode, COLOR_REGION_MATCH_MODES, 'matchMode', path);
    checkEnum(cond.pointsMatchMode, COLOR_MATCH_MODES, 'pointsMatchMode', path);
    checkEnum(cond.findDirection, COLOR_FIND_DIRECTIONS, 'findDirection', path);
    const pointCount = checkColorAtPoints(cond.points, path);
    checkPointsRequiredCount(cond, path, 'pointsRequiredMatchCount', pointCount);
    if (pointCount > 0 && cond.matchMode !== 'FIND_TARGETS') {
      info(
        'color_region 的 points 非空但 matchMode 不是 "FIND_TARGETS"：多点找色只在 `matchMode="FIND_TARGETS"` 时生效，' +
          '当前写法下这些采样点会被忽略（默认 matchMode=REGION_MATCH）',
        path
      );
    }
  } else if (type === 'text_exists') {
    for (const f of ['left', 'top', 'right', 'bottom', 'text']) if (!has(cond, f)) error(`text_exists 缺少必填字段 ${f}`, path);
    checkEnum(cond.textMatchMode, new Set(['ANY', 'ALL', 'N_OF']), 'textMatchMode', path);
  } else if (type === 'template_match') {
    if (!has(cond, 'templateBase64') && !(Array.isArray(cond.templates) && cond.templates.length)) {
      error('template_match 需提供 templateBase64 或非空 templates', path);
    }
    checkEnum(cond.templateMatchMode, new Set(['ANY', 'ALL', 'N_OF']), 'templateMatchMode', path);
    if (Array.isArray(cond.templates)) {
      cond.templates.forEach((t, i) => {
        if (!isObj(t) || typeof t.templateBase64 !== 'string' || !t.templateBase64) {
          error(`templates[${i}] 每项需含非空字符串 templateBase64`, path);
        }
      });
    }
  }
  if (type !== 'template_match' && cond.color !== undefined && typeof cond.color !== 'number') {
    error('color 必须是数字（ARGB Int，可用负补码）', path);
  }
}

/**
 * 多点比色 / 多点找色共用的采样点校验（S-手势面板-5T12 / 5T24）。
 *
 * 边界：只校验 `ColorAtPoint` 数组的形状与取值范围；责任：拦住
 * ① 采样点容差为负、② `N_OF` 的 N 超过采样点数（App 内运行时校验器直接判 ERROR 的两类），
 * ③ 百分比偏移写成绝对屏幕百分比（真机表现为"锚点换位置后采样点钉死"），
 * ④ 类型写错导致整脚本导入失败。
 *
 * @returns 采样点数量（调用方据此给 `matchMode` 相关提示）
 */
function checkColorAtPoints(points, path) {
  if (points === undefined || points === null) return 0;
  if (!Array.isArray(points)) {
    error(`points 必须是数组（元素为 ColorAtPoint）`, path + '.points');
    return 0;
  }
  points.forEach((p, i) => {
    const pp = `${path}.points[${i}]`;
    if (!isObj(p)) { error('points 的每一项必须是对象（ColorAtPoint）', pp); return; }
    for (const f of ['dx', 'dy', 'color', 'tolerance']) {
      if (p[f] !== undefined && typeof p[f] !== 'number') {
        error(`points[${i}].${f} 必须是数字`, pp);
      }
    }
    if (typeof p.tolerance === 'number' && p.tolerance < 0) {
      error(`points[${i}].tolerance 不能小于 0（App 内校验器会判 ERROR；<=0 表示沿用锚点容差）`, pp);
    }
    for (const f of ['dxPct', 'dyPct']) {
      const v = p[f];
      if (v === undefined) continue;
      if (typeof v !== 'number') { error(`points[${i}].${f} 必须是数字（未设置写哨兵 -2）`, pp); continue; }
      if (v !== -2 && (v < -1 || v > 1)) {
        warn(
          `points[${i}].${f}=${v} 超出 (-1,1)：它是**相对锚点**的百分比偏移（未设置写哨兵 -2）。` +
            '相对偏移通常是很小的比例（如 0.02 ≈ 20px/1080），写成绝对屏幕百分比或误填大值都会让采样点偏掉',
          pp
        );
      }
    }
    if (!has(p, 'color')) warn(`points[${i}] 缺少 color（该处应有的颜色，ARGB Int）`, pp);
  });
  return points.length;
}

/** N_OF 的 N 范围校验（多点比色/找色共用；N 必须落在 1~采样点数之间） */
function checkPointsRequiredCount(cond, path, nField, count) {
  if (cond.pointsMatchMode !== 'N_OF') return;
  const n = cond[nField];
  if (typeof n !== 'number' || n < 1 || n > count) {
    error(
      `pointsMatchMode=N_OF 时 ${nField} 必须在 1~采样点数之间（当前 ${n}，采样点 ${count}）`,
      path
    );
  }
}

/** 校验条件组 */
function checkConditionGroup(group, path) {
  if (!isObj(group)) { error(`条件组必须是对象`, path); return; }
  checkEnum(group.mode, new Set(['ALL', 'ANY', 'N_OF']), 'mode', path);
  if (group.mode === 'N_OF') {
    if (typeof group.requiredMatchCount !== 'number' || group.requiredMatchCount < 1) {
      error('N_OF 模式需要 requiredMatchCount >= 1', path);
    }
  }
  if (group.items !== undefined) {
    if (!Array.isArray(group.items)) { error('conditions.items 必须是数组', path); return; }
    group.items.forEach((item, i) => {
      const p = `${path}.items[${i}]`;
      checkEnum(item.type, CONDITION_ITEM_TYPES, '条件项 type', p);
      if (item.type === 'vision') checkVisionCondition(item.condition, p + '.condition');
      if (item.type === 'variable') {
        for (const f of ['key', 'op']) if (!has(item, f)) error(`variable 条件缺少必填字段 ${f}`, p);
        checkEnum(item.op, COMPARE_OPS, 'op', p);
      }
      if (item.type === 'expression' && !has(item, 'expression')) error('expression 条件缺少必填字段 expression', p);
    });
  }
}

/** 校验动作 */
function checkAction(action, path) {
  if (!isObj(action)) { error(`动作必须是对象`, path); return; }
  const type = action.type;
  if (!ACTION_TYPES.has(type)) { error(`动作 type "${type}" 不存在（允许清单见技能 §3.2）`, path); return; }
  for (const f of ACTION_REQUIRED[type] || []) {
    if (!has(action, f)) error(`动作 ${type} 缺少必填字段 ${f}`, path);
  }
  // run_code JS 命名检查（已知踩坑：vars/sys/node/net/file 是错误命名，源码 RunCodeHandler.kt 注册的是 variables/screen/nodes/network/files）
  if (type === 'run_code' && typeof action.code === 'string') {
    const BAD_NS = [
      { bad: 'runtime.vars.', good: 'runtime.variables.', hint: '变量命名空间' },
      { bad: 'runtime.sys.', good: 'runtime.screen.', hint: '屏幕命名空间' },
      { bad: 'runtime.node.', good: 'runtime.nodes.', hint: '节点命名空间' },
      { bad: 'runtime.net.', good: 'runtime.network.', hint: '网络命名空间' },
      { bad: 'runtime.file.', good: 'runtime.files.', hint: '文件命名空间' },
    ];
    for (const { bad, good, hint } of BAD_NS) {
      if (action.code.includes(bad)) {
        warn(`run_code 内 "${bad}" 是错误命名（应为 "${good}"，${hint}），运行会报 undefined`, path + '.code');
      }
    }
  }
  // 坐标双写提示（xPct 在 0..1 才算设置了百分比）
  warnMissingPercents(action, type, path);
  // 单指/多指：触点路径节点结构与坐标双写（S-触控-路径-1）
  if (type === 'single_touch' && isObj(action.pointer)) {
    checkTouchPointer(action.pointer, path + '.pointer');
  }
  if (type === 'multi_touch' && Array.isArray(action.pointers)) {
    if (action.pointers.length === 0) {
      warn('multi_touch.pointers 是空数组：没有任何手指按下，动作不会有任何效果', path);
    }
    action.pointers.forEach((pointer, i) => checkTouchPointer(pointer, `${path}.pointers[${i}]`));
  }
  // selector 存在性
  if (action.selector !== undefined && !isObj(action.selector)) error('selector 必须是对象', path);
  // S1451 ai_reply 记忆/OCR 字段
  if (type === 'ai_reply') {
    checkEnum(action.memoryMode, new Set(['NONE', 'SESSION']), 'memoryMode', path);
    if (action.ocrContext !== undefined && typeof action.ocrContext !== 'boolean') {
      error('ai_reply.ocrContext 必须是布尔值', path);
    }
    if (action.memoryWindow !== undefined &&
        (typeof action.memoryWindow !== 'number' || action.memoryWindow < 1 || action.memoryWindow > 20)) {
      error('ai_reply.memoryWindow 必须是 1~20 的数字', path);
    }
    if (action.memoryPersist !== undefined && typeof action.memoryPersist !== 'boolean') {
      error('ai_reply.memoryPersist 必须是布尔值', path);
    }
    // S1452 发送识别
    checkEnum(action.sendDetectMode, new Set(['COORD', 'AUTO_TEXT', 'AUTO_TEMPLATE']), 'sendDetectMode', path);
    if (action.sendDelayMs !== undefined &&
        (typeof action.sendDelayMs !== 'number' || action.sendDelayMs < 0 || action.sendDelayMs > 5000)) {
      error('ai_reply.sendDelayMs 必须是 0~5000 的数字', path);
    }
    // S1453 OCR 聊天上下文
    checkEnum(action.ocrMySide, new Set(['RIGHT', 'LEFT']), 'ocrMySide', path);
  }
  // S1452 node_input / no_control_input 提交方式与延迟
  if (type === 'node_input' || type === 'no_control_input') {
    checkEnum(action.submitMode, new Set(['NONE', 'TAP_COORDINATE', 'ENTER_KEY', 'AUTO_TEXT', 'AUTO_TEMPLATE']), 'submitMode', path);
    if (action.submitDelayMs !== undefined &&
        (typeof action.submitDelayMs !== 'number' || action.submitDelayMs < 0 || action.submitDelayMs > 5000)) {
      error(`${type}.submitDelayMs 必须是 0~5000 的数字`, path);
    }
  }
  // S-事件源-25：prompt 的弹窗控件（PromptControl 多态数组）—— 旧版完全没有分支，是"静默导入失败"的高发区
  if (type === 'prompt') {
    checkEnum(action.displayType, PROMPT_DISPLAY_TYPES, 'displayType', path);
    checkPromptControls(action.controls, path + '.controls');
  }
  // S-事件源-25：通用「值类型 ≠ 模型类型」扫描（对象 / 数组 / 数字 / 布尔 / 枚举）
  checkFieldTypes(action, ACTION_FIELD_TYPES[type], path);
}

/* ============ S-事件源-25：字段值类型与弹窗控件校验 ============ */

/**
 * 通用字段类型校验（值类型 ≠ 模型类型 → 阻断）。
 * 依据：App 端 kotlinx.serialization 遇到类型不符会抛异常，导致**整个脚本导入失败**（本轮 prompt_form 的真实案例）。
 */
function checkFieldTypes(host, table, path) {
  if (!table) return;
  for (const [field, expect] of Object.entries(table)) {
    const v = host[field];
    if (v === undefined) continue; // 缺省走模型默认值，不算错
    if (!typeMatches(v, expect)) {
      error(
        `${path}.${field} 类型不符：期望 ${expect}，实际 ${describeType(v)}` +
        `（该字段在模型里不是这个类型，App 端反序列化会失败 ⇒ 脚本导入不了）`,
        `${path}.${field}`
      );
    }
  }
}

/** 期望类型判定；"enum:XXX" 交给 checkEnum 单独报（这里不重复，避免同一问题报两次） */
function typeMatches(v, expect) {
  if (expect.startsWith('enum:')) return true;
  switch (expect) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return isObj(v);
    case 'objectOrNull': return v === null || isObj(v);
    case 'array': return Array.isArray(v);
    case 'numberOrNull': return v === null || (typeof v === 'number' && Number.isFinite(v));
    default: return true;
  }
}

function describeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return `string("${v.length > 12 ? v.slice(0, 12) + '…' : v}")`;
  return typeof v;
}

/* ============ S-触控-路径-1 修订：单指/多指触点与坐标双写 ============ */

/** 像素坐标「已设置」判定（-1 等负值表示未设置） */
function isSetPixel(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** 百分比「已设置」判定（模型用 -1f 表示未设置，只有 0..1 会被运行时采用） */
function isPercent(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** 单条字段是否填了"真值"：空串 / null / 空数组 / 空对象算占位（用 items 时的推荐写法），不算真值 */
function hasRealValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) {
    if (typeof v.expression === 'string') return v.expression.trim() !== '';
    return Object.keys(v).length > 0;
  }
  return true; // 数字 / 布尔等字面量
}

/**
 * 表驱动的坐标双写提示：只对「给了有效像素值、却没给百分比」的动作报警告。
 * 单指/多指不在表内（它们是触点里的 pathNodes，逐节点判定见 [checkTouchPathNode]）。
 */
function warnMissingPercents(action, type, path) {
  const pairs = COORD_DOUBLE_WRITE[type];
  if (!pairs) return;
  const missing = pairs.filter(([px, pct]) => isSetPixel(action[px]) && !isPercent(action[pct]));
  if (missing.length === 0) return;
  const names = missing.map(([px, pct]) => `${px}→${pct}`).join('、');
  warn(`动作 ${type} 建议同时提供百分比（当前缺 ${names}，0..1 之间），跨分辨率更稳`, path);
}

/**
 * 触点校验（一根手指）。
 *
 * 边界：只校验 `single_touch.pointer` / `multi_touch.pointers[i]` 的结构、枚举与坐标双写；
 * 责任：拦住「pathNodes 缺失/为空」「枚举拼错」「坐标点只给像素」三类问题 ——
 * 前两类在 App 端要么直接导入失败、要么解析失败即动作失败，第三类会静默失稳。
 */
function checkTouchPointer(pointer, p) {
  if (!isObj(pointer)) { error('触点必须是对象（TouchPointer）', p); return; }
  // pathNodes 在模型里无默认值：缺失 ⇒ kotlinx 反序列化抛异常 ⇒ 整个脚本导入不了
  if (!Array.isArray(pointer.pathNodes)) {
    error('触点缺少 pathNodes（必填字段，旧写法 points 请改为 pathNodes），否则脚本导入失败', p);
  } else if (pointer.pathNodes.length === 0) {
    error('触点 pathNodes 是空数组：至少要有 1 个路径节点', p);
  } else {
    pointer.pathNodes.forEach((node, i) => checkTouchPathNode(node, `${p}.pathNodes[${i}]`));
  }
  if (!has(pointer, 'duration')) {
    error('触点缺少 duration（必填字段，整条路径耗时 ms）', p);
  } else if (typeof pointer.duration !== 'number') {
    error('触点 duration 必须是数字（毫秒）', p + '.duration');
  }
  checkEnum(pointer.pathType, TOUCH_PATH_TYPES, 'pathType', p);
  checkTouchSegments(pointer.segments, p);
}

/** 多段触摸（可选）：同一手指的多次独立按下片段（段间抬起） */
function checkTouchSegments(segments, p) {
  if (segments === undefined || segments === null) return;
  if (!Array.isArray(segments)) { error('触点 segments 必须是数组', p + '.segments'); return; }
  segments.forEach((seg, i) => {
    const sp = `${p}.segments[${i}]`;
    if (!isObj(seg)) { error('多段触摸的每一段必须是对象', sp); return; }
    if (!Array.isArray(seg.pathNodes) || seg.pathNodes.length === 0) {
      error(`多段触摸第 ${i + 1} 段缺少非空 pathNodes`, sp);
    } else {
      seg.pathNodes.forEach((node, j) => checkTouchPathNode(node, `${sp}.pathNodes[${j}]`));
    }
    if (typeof seg.duration !== 'number') error('多段触摸每一段必须有数字 duration', sp + '.duration');
  });
}

/**
 * 路径节点校验（TouchPathNode，自带来源）。
 * 默认来源是 COORDINATE —— 老脚本可能整个 sourceType 都不写。
 */
function checkTouchPathNode(node, p) {
  if (!isObj(node)) { error('路径节点必须是对象（TouchPathNode）', p); return; }
  checkEnum(node.sourceType, TOUCH_TARGET_SOURCE_TYPES, 'sourceType', p);
  const sourceType = node.sourceType === undefined ? 'COORDINATE' : node.sourceType;
  if (sourceType === 'COORDINATE') {
    // 坐标双写：像素与百分比都建议给（运行时 `xPct ∈ 0..1` 优先按百分比）
    if (isSetPixel(node.x) && !isPercent(node.xPct)) {
      warn('路径节点建议同时提供 xPct（0..1 百分比），只给像素换分辨率会偏', p);
    }
    if (isSetPixel(node.y) && !isPercent(node.yPct)) {
      warn('路径节点建议同时提供 yPct（0..1 百分比），只给像素换分辨率会偏', p);
    }
  } else if (sourceType === 'VARIABLE') {
    if (!isNonEmptyString(node.pointVarKey)) warn('VARIABLE 路径节点缺少 pointVarKey，运行时会回退静态兜底坐标', p);
  } else if (sourceType === 'IMAGE' || sourceType === 'TEXT' || sourceType === 'COLOR') {
    if (!isObj(node.condition)) warn(`${sourceType} 路径节点缺少 condition，运行时该点解析失败（动作会失败）`, p);
  } else if (sourceType === 'NODE') {
    if (!isObj(node.selector)) warn('NODE 路径节点缺少 selector，运行时该点解析失败（动作会失败）', p);
  } else if (sourceType === 'TOUCH_DOWN') {
    if (!isNonEmptyString(node.touchDownRefId)) warn('TOUCH_DOWN 路径节点缺少 touchDownRefId，找不到引用就无法解析该点', p);
  }
}

/**
 * 弹窗控件校验（对应 PromptControl 的五个子类：button / input / switch / slider / checkbox）。
 * 关键拦截点：button.binding 必须是对象或 null —— 写成空串 "" 是真实踩过的坑（整脚本导入失败）。
 */
function checkPromptControls(controls, path) {
  if (controls === undefined) return;
  if (!Array.isArray(controls)) {
    error('prompt.controls 必须是数组', path);
    return;
  }
  controls.forEach((c, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(c)) { error('弹窗控件必须是对象', p); return; }
    const t = c.type;
    if (!PROMPT_CONTROL_TYPES.has(t)) {
      error(`弹窗控件 type "${t}" 不存在（允许：button / input / switch / slider / checkbox）`, p);
      return;
    }
    checkFieldTypes(c, PROMPT_CONTROL_FIELDS[t], p);
    if (t === 'button') checkEnum(c.style, PROMPT_BUTTON_STYLES, 'style', p);
    if (t === 'input') checkEnum(c.pickMode, PROMPT_INPUT_PICK_MODES, 'pickMode', p);
    if (t === 'slider' && typeof c.min === 'number' && typeof c.max === 'number' && c.min > c.max) {
      warn(`slider.min(${c.min}) 大于 max(${c.max})，运行时取值会异常`, p);
    }
    // 控件必须写清作用对象：输入/开关/滑块/多选框都需要 targetVariable 才能写回变量
    if (t !== 'button' && !has(c, 'targetVariable')) {
      warn(`弹窗控件 ${t} 未设置 targetVariable，运行时会拿不到用户输入的值`, p);
    }
  });
}

/**
 * 多变量 items 校验（S-变量操作多变量）
 * - set_var/inc_var/get_var 的 items 非空时：执行引擎逐条执行，且**优先于单条 key/value**
 * - 条目 type 为空时回退宿主节点类型；非空时以条目为准（可在同一节点混用 set/inc/get）
 * - 宿主节点的 key/value（get_var 为 sourceKey/targetKey）在模型里无默认值 → 即使只用 items 也必须存在
 */
const VARIABLE_ITEM_TYPES = new Set(['set', 'inc', 'get']);
function checkVariableItems(node, hostType, path) {
  const items = node.items;
  if (items === undefined) return;
  if (!Array.isArray(items)) { error('items 必须是数组', path + '.items'); return; }
  if (items.length === 0) return;
  // 单条字段「填了真值」才会被忽略 → 只有这种冗余填法才提示（"留空串占位"是推荐写法，不提示）
  if (hostType === 'set_var' && (isNonEmptyString(node.key) || hasRealValue(node.value))) {
    warn('set_var 的 items 非空 → 单条 key/value 会被忽略（推荐留空串占位如 "key":"","value":""）', path);
  }
  if (hostType === 'inc_var' && isNonEmptyString(node.key)) {
    warn('inc_var 的 items 非空 → 单条 key/delta 会被忽略（推荐留空串占位如 "key":""）', path);
  }
  if (hostType === 'get_var' && (isNonEmptyString(node.sourceKey) || isNonEmptyString(node.targetKey))) {
    warn('get_var 的 items 非空 → 单条 sourceKey/targetKey 会被忽略（推荐留空串占位）', path);
  }
  items.forEach((it, i) => {
    const ip = path + '.items[' + i + ']';
    if (!isObj(it)) { error('items 条目必须是对象', ip); return; }
    checkEnum(it.type, VARIABLE_ITEM_TYPES, 'items[].type', ip);
    checkEnum(it.scope, SCOPES, 'items[].scope', ip);
    const t = it.type || (hostType === 'set_var' ? 'set' : hostType === 'inc_var' ? 'inc' : 'get');
    if (!has(it, 'key') || String(it.key).trim() === '') {
      warn('items[' + i + ']（' + t + '）缺少目标变量名 key', ip);
    }
    if (t === 'set' && !has(it, 'value')) {
      warn('items[' + i + ']（set）缺少 value', ip);
    }
    if (t === 'get' && (!has(it, 'sourceKey') || String(it.sourceKey).trim() === '')) {
      warn('items[' + i + ']（get）缺少来源变量 sourceKey', ip);
    }
  });
}

/** 校验节点（递归）；inStructural=true 表示位于结构容器内部（if/循环/trycatch/var_switch/race/subflow 分支块） */
function checkNode(node, path, inStructural = false) {
  if (!isObj(node)) { error(`节点必须是对象`, path); return; }
  const type = node.type;
  if (!NODE_TYPES.has(type)) { error(`节点 type "${type}" 不存在（允许清单见技能 §3.1）`, path); return; }
  if (node.id) nodeIds.add(node.id);
  if (type === 'label') {
    labelNames.add(node.name);
    if (inStructural) structuralLabels.add(node.name);
  }
  if (type === 'subflow_def' && typeof node.name === 'string' && node.name) subflowNames.add(node.name);

  for (const f of NODE_REQUIRED[type] || []) {
    if (!has(node, f)) error(`节点 ${type} 缺少必填字段 ${f}`, path);
  }

  const p = path + (node.displayName ? `(${node.displayName})` : '');

  if (type === 'action') {
    checkAction(node.action, p + '.action');
    const cfg = node.config;
    if (isObj(cfg)) {
      checkEnum(cfg.onSuccess, OUTCOME_STRATEGIES, 'onSuccess', p + '.config');
      checkEnum(cfg.onFail, OUTCOME_STRATEGIES, 'onFail', p + '.config');
      checkEnum(cfg.successTargetType, OUTCOME_TARGET_TYPES, 'successTargetType', p + '.config');
      checkEnum(cfg.failTargetType, OUTCOME_TARGET_TYPES, 'failTargetType', p + '.config');
      if (cfg.runtimeConditions) checkConditionGroup(cfg.runtimeConditions, p + '.config.runtimeConditions');
      if (cfg.repeat !== undefined && typeof cfg.repeat !== 'number') error('config.repeat 必须是数字', p + '.config');
      if (cfg.repeat === 0) warn('config.repeat=0 表示不执行（-1 才是无限），请确认意图', p + '.config');
    }
  } else if (type === 'if') {
    if (node.conditions) checkConditionGroup(node.conditions, p + '.conditions');
    if (node.varCondition && isObj(node.varCondition)) {
      checkEnum(node.varCondition.mode, new Set(['COMPARE', 'EXPRESSION']), 'varCondition.mode', p + '.varCondition');
      if (node.varCondition.op) checkEnum(node.varCondition.op, COMPARE_OPS, 'varCondition.op', p + '.varCondition');
    }
  } else if (type === 'var_switch') {
    checkEnum(node.matchMode, new Set(['TEXT_EQUALS', 'TEXT_CONTAINS', 'NUMBER_EQUALS']), 'matchMode', p);
  } else if (type === 'while_var') {
    checkEnum(node.op, COMPARE_OPS, 'op', p);
    if (node.maxIterations === undefined) warn('while_var 建议显式 maxIterations 防死循环', p);
  } else if (type === 'repeat') {
    if (typeof node.times === 'number' && node.times <= 0) error('repeat.times 必须 > 0（-1/0 不支持无限）', p);
  } else if (type === 'set_var') {
    checkEnum(node.scope, SCOPES, 'scope', p);
    // 表达式对象形态
    if (isObj(node.value) && node.value.kind === 'expression' && !has(node.value, 'expression')) {
      error('set_var 表达式对象缺少 expression 字段', p + '.value');
    }
    checkVariableItems(node, 'set_var', p);
  } else if (type === 'inc_var' || type === 'get_var') {
    checkEnum(node.scope, SCOPES, 'scope', p);
    checkVariableItems(node, type, p);
  } else if (type === 'call_subflow') {
    subflowNames; // 收集在遍历后统一校验
  } else if (type === 'goto') {
    // 引用完整性在遍历后统一校验
  } else if (type === 'move_pointer') {
    // 通过 touch_down 节点收集 ref（在 action 分支处理）
  }

  // 递归子块：'block' 是顺序块（继承 inStructural——顺序块链内标签支持跨层跳转）；
  // thenBlock/elseBlock 等结构容器内部一律标记 inStructural=true（引擎不收集，跨层跳入会失效）
  for (const key of ['block', 'thenBlock', 'elseBlock', 'tryBlock', 'catchBlock', 'leftBlock', 'rightBlock', 'defaultBlock']) {
    const b = node[key];
    if (isObj(b) && Array.isArray(b.nodes)) {
      const childStructural = (key === 'block') ? inStructural : true;
      b.nodes.forEach((n, i) => checkNode(n, `${p}.${key}.nodes[${i}]`, childStructural));
    }
  }
  if (type === 'var_switch' && Array.isArray(node.cases)) {
    node.cases.forEach((c, i) => {
      if (isObj(c) && isObj(c.block)) c.block.nodes.forEach((n, j) => checkNode(n, `${p}.cases[${i}].block.nodes[${j}]`, true));
    });
  }
  // 动作内的 touch_down 引用收集
  if (type === 'action' && isObj(node.action)) {
    const a = node.action;
    if (a.type === 'touch_down' && (node.id || a.pointerId !== undefined)) {
      touchDownRefs.add(node.id ?? String(a.pointerId));
    }
    if (a.type === 'move_pointer' && a.touchDownRefId) {
      if (!touchDownRefs.has(a.touchDownRefId) && !nodeIds.has(a.touchDownRefId)) {
        warn(`move_pointer.touchDownRefId="${a.touchDownRefId}" 找不到对应 touch_down（可能引用节点 id 或 pointerId）`, p);
      }
    }
    // 触点路径里的 TOUCH_DOWN 节点引用（与 move_pointer 同口径：找不到只警告、不阻断）
    if (a.type === 'single_touch' || a.type === 'multi_touch') {
      const pointers = a.type === 'single_touch'
        ? (isObj(a.pointer) ? [a.pointer] : [])
        : (Array.isArray(a.pointers) ? a.pointers : []);
      pointers.forEach((ptr, pi) => {
        if (!isObj(ptr) || !Array.isArray(ptr.pathNodes)) return;
        // 路径前缀精确到触点：single_touch 只有一个 pointer，multi_touch 按手指下标
        const pointerPath = a.type === 'single_touch'
          ? `${p}.action.pointer`
          : `${p}.action.pointers[${pi}]`;
        ptr.pathNodes.forEach((node, ni) => {
          if (isObj(node) && node.sourceType === 'TOUCH_DOWN' && isNonEmptyString(node.touchDownRefId) &&
              !touchDownRefs.has(node.touchDownRefId) && !nodeIds.has(node.touchDownRefId)) {
            warn(
              `路径节点 touchDownRefId="${node.touchDownRefId}" 找不到对应 touch_down（可能引用节点 id 或 pointerId）`,
              `${pointerPath}.pathNodes[${ni}]`
            );
          }
        });
      });
    }
  }
}

function checkConsoleVariables(list, path) {
  if (!Array.isArray(list)) { error(`${path} 必须是数组`, path); return; }
  list.forEach((v, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(v)) { error('控制台变量必须是对象', p); return; }
    if (!has(v, 'key')) error('控制台变量缺少必填字段 key', p);
    if (typeof v.key !== 'string') error('key 必须是字符串', p);
    // .axs 导入走严格 Json：defaultValue 是 String（S1440 实测坑）
    if (has(v, 'defaultValue') && typeof v.defaultValue !== 'string') {
      error(`defaultValue 必须是字符串（模型为 String），当前是 ${typeof v.defaultValue}——.axs 导入会报"格式不正确"`, p);
    }
    if (typeof v.defaultScope === 'string' && v.defaultScope !== '') checkEnum(v.defaultScope, SCOPES, 'defaultScope', p);
    checkEnum(v.controlType, CONSOLE_CONTROL_TYPES, 'controlType', p);
  });
}

function checkScript(root) {
  for (const f of ['id', 'name', 'root']) {
    if (!has(root, f)) error(`Script 顶层缺少必填字段 ${f}`, 'root');
  }
  if (typeof root.id !== 'string') error('id 必须是字符串', 'root.id');
  if (typeof root.name !== 'string') error('name 必须是字符串', 'root.name');
  if (typeof root.baseScreenWidth === 'string') error('baseScreenWidth 必须是数字', 'root.baseScreenWidth');
  if (typeof root.baseScreenHeight === 'string') error('baseScreenHeight 必须是数字', 'root.baseScreenHeight');
  if (root.consoleVariables) checkConsoleVariables(root.consoleVariables, 'consoleVariables');
  checkPublishAuthor(root.publishMeta, 'publishMeta');
  checkNoPlainApiKey(root, 'root');
  if (!isObj(root.root) || !Array.isArray(root.root.nodes)) {
    error('root 必须是 { nodes: [...] } 结构', 'root.root');
    return;
  }
  root.root.nodes.forEach((n, i) => checkNode(n, `root.nodes[${i}]`));
  checkVariableBatching(root.root.nodes, 'root.nodes');
}

/* ============ 变量批量合并提示（`items` 写法护栏） ============ */

/**
 * 连续变量节点提示：**同一处**（同一个 nodes 数组里相邻）连续 ≥3 个变量节点、且都没用 `items` 时，
 * 提示"可合并为一个节点 + items 一次执行"。
 *
 * 为什么用 `ℹ` 而不是警告：逐个写也能跑，只是节点多、日志吵、后续改动要逐个找。
 * 阈值取 ≥3 是为了避开噪声（2 个相邻变量节点很常见，例如"设 flag → 设计数"）。
 * 依据：`SetVar`/`IncVar`/`GetVar` 都支持 `items`（非空时逐条执行、优先于单条字段），见 SKILL.md §4.3。
 */
function checkVariableBatching(nodes, path) {
  if (!Array.isArray(nodes)) return;
  const isVarNode = (n) => isObj(n) && (n.type === 'set_var' || n.type === 'inc_var' || n.type === 'get_var');
  const usesItems = (n) => Array.isArray(n.items) && n.items.length > 0;
  let i = 0;
  while (i < nodes.length) {
    if (isVarNode(nodes[i]) && !usesItems(nodes[i])) {
      let j = i;
      while (j + 1 < nodes.length && isVarNode(nodes[j + 1]) && !usesItems(nodes[j + 1])) j++;
      const len = j - i + 1;
      if (len >= 3) {
        const keys = nodes.slice(i, j + 1).map((n) => n.key ?? n.sourceKey ?? '?').join('、');
        info(
          `同一处连续 ${len} 个变量节点（${keys}）建议合并为一个节点 + items 一次执行（见技能 §4.3）`,
          `${path}[${i}..${j}]`
        );
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  // 递归进各分支块
  nodes.forEach((n, idx) => {
    if (!isObj(n)) return;
    for (const key of ['block', 'thenBlock', 'elseBlock', 'tryBlock', 'catchBlock', 'leftBlock', 'rightBlock', 'defaultBlock']) {
      const b = n[key];
      if (isObj(b) && Array.isArray(b.nodes)) checkVariableBatching(b.nodes, `${path}[${idx}].${key}.nodes`);
    }
    if (Array.isArray(n.cases)) {
      n.cases.forEach((c, ci) => {
        if (isObj(c) && isObj(c.block) && Array.isArray(c.block.nodes)) {
          checkVariableBatching(c.block.nodes, `${path}[${idx}].cases[${ci}].block.nodes`);
        }
      });
    }
  });
}

/* ============ 作者归属 / 发布社区（S-脚本作者-1） ============ */

/**
 * 作者归属校验（边界：只查顶层 `publishMeta` 里与"能否发布社区"相关的两个字段）。
 *
 * 责任：① 拦住"作者 uid 类型写错"（模型是 `Int?`，写字符串/小数会让整脚本导入失败）；
 * ② 用 `ℹ` 提示"没填作者"——AI 产出的明文 JSON 导入后 `importedFromShare` 必为 true，
 * 本机没有作者归属时脚本列表不会出现「发布到社区」入口。
 *
 * 依据：发布资格 = `(!importedFromShare && 作者为空) || 作者 == 当前登录用户`
 * （`CommunityMainHostFacade.resolveLocalScriptPublishEntryState`），详见 SKILL.md §2.3。
 */
function checkPublishAuthor(publishMeta, path) {
  if (publishMeta === undefined || publishMeta === null) {
    infoNoAuthor();
    return;
  }
  if (!isObj(publishMeta)) {
    error(`publishMeta 必须是对象（模型是 ScriptPublishMeta），当前是 ${describeType(publishMeta)}——导入会失败`, path);
    return;
  }
  const authorUid = publishMeta.community_author_user_id;
  if (authorUid !== undefined && authorUid !== null) {
    if (typeof authorUid !== 'number' || !Number.isInteger(authorUid)) {
      error(
        `community_author_user_id 必须是整数（模型是 Int?），当前是 ${describeType(authorUid)}——导入会失败`,
        path + '.community_author_user_id'
      );
    } else if (authorUid <= 0) {
      warn(
        'community_author_user_id <= 0：模型用 null 表示未设置，写 0/负数等于没填，导入后仍无作者归属',
        path + '.community_author_user_id'
      );
    }
  }
  if (publishMeta.community_author_name !== undefined && publishMeta.community_author_name !== null &&
      typeof publishMeta.community_author_name !== 'string') {
    error(
      `community_author_name 必须是字符串，当前是 ${describeType(publishMeta.community_author_name)}`,
      path + '.community_author_name'
    );
  }
  const hasUid = typeof authorUid === 'number' && Number.isInteger(authorUid) && authorUid > 0;
  if (!hasUid) infoNoAuthor();
}

/** "未填作者"提示文案（三处共用，避免文案漂移） */
function infoNoAuthor() {
  info(
    '未填写 publishMeta.community_author_user_id：脚本导入后本机没有作者归属，' +
      '脚本列表不会出现「发布到社区」入口（可在 App 脚本详情页点「声明我是作者」，' +
      '或让用户提供自己的社区 uid 后写入 publishMeta）'
  );
}

/* ============ 安全：明文 API Key 拦截（S1450） ============ */

/** 递归检查：AI 配置只允许 apiKeyVarKey 变量引用，不允许明文 apiKey（社区分享防泄露） */
function checkNoPlainApiKey(obj, path) {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => checkNoPlainApiKey(v, path + '[' + i + ']'));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (/api_?key/i.test(k) && !/apikeyvar/i.test(k) && typeof obj[k] === 'string' && obj[k].length > 0) {
        error(`字段 ${k} 疑似明文 API Key（安全要求：仅用 apiKeyVarKey 变量引用，明文 key 会被社区分享泄露）`, path + '.' + k);
      }
      checkNoPlainApiKey(obj[k], path + '.' + k);
    }
  }
}

/* ============ 引用完整性（遍历后） ============ */
function checkReferences(root) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'goto' && typeof n.target === 'string') {
        if (!labelNames.has(n.target) && !nodeIds.has(n.target)) {
          error(`goto.target="${n.target}" 找不到对应 label 或节点 id`, '引用');
        } else if (structuralLabels.has(n.target)) {
          warn(`goto.target="${n.target}" 位于结构容器内部（if/循环/trycatch 等）：引擎仅支持同一结构内部的本层跳转，从外部/其它层跳入会失效（静默结束）——建议把标签移到外层顺序块`, '引用');
        }
      }
      if (n.type === 'action' && isObj(n.config)) {
        for (const f of ['jumpTargetOnSuccess', 'jumpTargetOnFail']) {
          const t = n.config[f];
          if (typeof t === 'string' && t && !labelNames.has(t) && !nodeIds.has(t)) {
            error(`config.${f}="${t}" 找不到对应 label 或节点 id`, '引用');
          } else if (typeof t === 'string' && t && structuralLabels.has(t)) {
            warn(`config.${f}="${t}" 位于结构容器内部（if/循环/trycatch 等）：引擎仅支持同一结构内部的本层跳转，从外部/其它层跳入会失效（静默结束）——建议把标签移到外层顺序块`, '引用');
          }
        }
      }
      if (n.type === 'call_subflow' && typeof n.targetName === 'string') {
        // S1451-修复2：补全 call_subflow → subflow_def 引用校验（此前空实现，子流程名打错不会报错）
        if (!subflowNames.has(n.targetName)) {
          error(`call_subflow.targetName="${n.targetName}" 找不到对应 subflow_def（已定义：${[...subflowNames].join('/') || '无'}）`, '引用');
        }
      }
      for (const key of ['block', 'thenBlock', 'elseBlock', 'tryBlock', 'catchBlock', 'leftBlock', 'rightBlock', 'defaultBlock']) {
        if (isObj(n[key]) && Array.isArray(n[key].nodes)) walk(n[key].nodes);
      }
      if (n.type === 'var_switch' && Array.isArray(n.cases)) {
        n.cases.forEach((c) => { if (isObj(c) && isObj(c.block)) walk(c.block.nodes); });
      }
    }
  };
  walk(root.root?.nodes || []);
}

/* ============ 入口 ============ */

const file = process.argv[2];
if (!file) {
  console.error('用法: node validate-script.mjs <脚本文件.axs|.json> [--strict]');
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ JSON 语法错误: ${e.message}`);
  process.exit(1);
}

if (Array.isArray(parsed) || (isObj(parsed) && Array.isArray(parsed.nodes))) {
  // 允许裸节点列表（粘贴格式）——包装成 Script 再校验
  parsed = { id: '(list)', name: '(节点列表)', root: { nodes: Array.isArray(parsed) ? parsed : parsed.nodes } };
}
if (isObj(parsed) && Array.isArray(parsed.steps)) {
  console.error('✗ 这是 AI 简化格式 {steps:[...]}，请先转换成完整节点 JSON（见技能 §2）');
  process.exit(1);
}

checkScript(parsed);
checkReferences(parsed);

const strict = process.argv.includes('--strict');
const exitErrors = strict ? errors : errors; // 错误总是阻断

console.log('──────── 校验报告 ────────');
console.log(`脚本: ${parsed.name} (id=${parsed.id})`);
console.log(`节点树: ${labelNames.size} 个标签, ${nodeIds.size} 个带 id 节点, ${subflowNames.size} 个子流程`);
if (notes.length) {
  console.log(`\nℹ 提示 ${notes.length} 条（不影响导入/运行）:`);
  notes.forEach((n) => console.log(`  - ${n}`));
}
if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length} 条:`);
  warnings.forEach((w) => console.log(`  - ${w}`));
}
if (errors.length) {
  console.log(`\n✗ 错误 ${errors.length} 条（需修复后才能 .axs 导入）:`);
  errors.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
console.log('\n✓ 校验通过：无必填/枚举/类型/引用错误（最终以 App 内 ScriptValidator 为准）');
