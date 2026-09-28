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
const CONDITION_ITEM_TYPES = new Set([
  'vision', 'time', 'variable', 'expression', 'action_run_status',
  'screen_on', 'screen_locked', 'node', 'run_count_limit',
]);
const COMPARE_OPS = new Set(['LT', 'LE', 'EQ', 'NE', 'GE', 'GT']);
const SCOPES = new Set(['LOCAL', 'GLOBAL']);
const OUTCOME_STRATEGIES = new Set(['CONTINUE', 'STOP', 'RETRY', 'GOTO']);
const OUTCOME_TARGET_TYPES = new Set(['LABEL', 'SUB_FLOW', 'ACTION']);
const CONSOLE_CONTROL_TYPES = new Set(['AUTO', 'TOGGLE', 'NUMBER', 'TEXT', 'SELECT', 'ARRAY']);
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
    checkEnum(cond.colorMatchMode, new Set(['ANY', 'ALL', 'N_OF']), 'colorMatchMode', path);
  } else if (type === 'color_region') {
    for (const f of ['left', 'top', 'right', 'bottom', 'color']) if (!has(cond, f)) error(`color_region 缺少必填字段 ${f}`, path);
    checkEnum(cond.colorMatchMode, new Set(['ANY', 'ALL', 'N_OF']), 'colorMatchMode', path);
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
  if (type !== 'template_match' && cond.color !== undefined && typeof cond.color === 'number') {
    // color 为 Int ARGB（可为负数补码），数值类型即可
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
  if (['tap', 'long_press', 'touch_down'].includes(type)) {
    if (has(action, 'x') && (action.xPct === undefined || action.xPct < 0)) {
      warn(`动作 ${type} 建议同时提供 xPct/yPct（0..1 百分比），跨分辨率更稳`, path);
    }
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
  // 单条字段被忽略的提示（模型要求它们仍必须存在，故只提示不报错）
  if (hostType === 'set_var' && (has(node, 'key') || has(node, 'value'))) {
    warn('set_var 的 items 非空 → 单条 key/value 会被忽略（为满足模型必填仍需存在，可留空串）', path);
  }
  if (hostType === 'inc_var' && has(node, 'key')) {
    warn('inc_var 的 items 非空 → 单条 key/delta 会被忽略（仍需存在，可留空串）', path);
  }
  if (hostType === 'get_var' && (has(node, 'sourceKey') || has(node, 'targetKey'))) {
    warn('get_var 的 items 非空 → 单条 sourceKey/targetKey 会被忽略（仍需存在，可留空串）', path);
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
  checkNoPlainApiKey(root, 'root');
  if (!isObj(root.root) || !Array.isArray(root.root.nodes)) {
    error('root 必须是 { nodes: [...] } 结构', 'root.root');
    return;
  }
  root.root.nodes.forEach((n, i) => checkNode(n, `root.nodes[${i}]`));
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
