{
  "id": "auto-quiz-answer-001",
  "name": "自动答题-题库匹配",
  "baseScreenWidth": 1080,
  "baseScreenHeight": 2400,
  "settings": {
    "runCount": 1,
    "defaultActionPreDelayMs": 200,
    "defaultActionPostDelayMs": 0,
    "pauseOnRuntimeError": true
  },
  "consoleVariables": [
    {
      "key": "题库文件路径",
      "label": "题库文件路径",
      "valueType": "文本",
      "controlType": "TEXT",
      "defaultValue": "/sdcard/WeMod/题库.txt",
      "enabled": true,
      "order": 0
    },
    {
      "key": "单题最大等待轮数",
      "label": "单题最大等待轮数(每轮约2秒)",
      "valueType": "数字",
      "controlType": "NUMBER",
      "defaultValue": "15",
      "minValue": 1,
      "maxValue": 200,
      "stepValue": 1,
      "enabled": true,
      "order": 1
    }
  ],
  "root": {
    "nodes": [
      {
        "type": "set_var",
        "key": "已答列表",
        "value": "",
        "comment": "记录已答过的题干关键词（| 分隔的文本列表），防止同一题重复作答"
      },
      {
        "type": "set_var",
        "key": "连续未中",
        "value": 0,
        "comment": "连续匹配失败轮数，用于判断题库是否答完或卡在非题目界面"
      },
      {
        "type": "set_var",
        "key": "连续已答轮数",
        "value": 0,
        "comment": "连续几轮屏幕上只有题库中已答过的题（≥2 判定题库已答完，提前结束不触发 AI 兜底）"
      },
      {
        "type": "set_var",
        "key": "已处理题号",
        "value": -1,
        "scope": "GLOBAL",
        "comment": "AI 兜底命中的题号，跨子流程回传给主流程（子流程内 LOCAL 写入返回后会回滚，必须用 GLOBAL）"
      },
      {
        "type": "action",
        "action": {
          "type": "file_action",
          "op": "EXISTS",
          "path": "/sdcard/WeMod/题库.txt",
          "pathVarKey": "题库文件路径",
          "bindToVar": "题库文件存在"
        },
        "comment": "检查题库文件是否存在"
      },
      {
        "type": "if",
        "varCondition": { "mode": "EXPRESSION", "expression": "题库文件存在 == false" },
        "comment": "题库文件不存在 → 提示并停止",
        "thenBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "displayType": "DIALOG",
                "title": "题库文件不存在",
                "content": "未找到题库文件：${题库文件路径}\n请按格式创建文件后重新运行"
              }
            },
            {
              "type": "action",
              "action": { "type": "run_control", "controlType": "STOP" }
            }
          ]
        },
        "elseBlock": { "nodes": [] }
      },
      {
        "type": "action",
        "action": {
          "type": "file_action",
          "op": "READ",
          "path": "/sdcard/WeMod/题库.txt",
          "pathVarKey": "题库文件路径",
          "encoding": "UTF-8",
          "bindToVar": "题库原文"
        },
        "comment": "读取题库文件内容到变量"
      },
      {
        "type": "action",
        "action": {
          "type": "run_code",
          "code": "// 解析题库文件为四个平行数组变量：题库题干/题库题型/题库答案/题库附加\n// 每行一题，| 分隔 4 列：题干关键词|题型|答案|附加文字\nvar 原文 = String(runtime.variables.get(\"题库原文\") || \"\");\nvar 行 = 原文.split(/\\r?\\n/);\nvar 题库题干 = [], 题库题型 = [], 题库答案 = [], 题库附加 = [];\nfor (var k = 0; k < 行.length; k++) {\n  var t = String(行[k]).replace(/^\\uFEFF/, \"\").trim();\n  if (!t) continue;\n  var f = t.split(\"|\");\n  if (f.length < 3) continue;\n  题库题干.push(f[0].trim());\n  题库题型.push(f[1].trim());\n  题库答案.push(f[2].trim());\n  题库附加.push(f.length > 3 ? f[3].trim() : \"\");\n}\n// 变量引擎不能直接存 JS 数组（NativeArray 会退化为文本），用 | 拼接成字符串，表达式侧用 split(变量,分隔符) 还原\nruntime.variables.set(\"题库题干\", 题库题干.join(\"|\"));\nruntime.variables.set(\"题库题型\", 题库题型.join(\"|\"));\nruntime.variables.set(\"题库答案\", 题库答案.join(\"|\"));\nruntime.variables.set(\"题库附加\", 题库附加.join(\"|\"));",
          "timeoutMs": 10000
        },
        "comment": "JS 解析题库文件，生成四个平行数组变量"
      },
      {
        "type": "set_var",
        "key": "题库总数",
        "value": { "kind": "expression", "expression": "len(split(题库题干, \"|\"))", "resultType": "NUMBER" },
        "comment": "题库总题数"
      },
      {
        "type": "if",
        "varCondition": { "mode": "COMPARE", "key": "题库总数", "op": "EQ", "value": "0" },
        "comment": "题库为空或格式错误 → 提示并停止",
        "thenBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "displayType": "DIALOG",
                "title": "题库为空",
                "content": "题库文件解析后为 0 题，请检查文件格式（每行：题干关键词|题型|答案|附加文字）"
              }
            },
            {
              "type": "action",
              "action": { "type": "run_control", "controlType": "STOP" }
            }
          ]
        },
        "elseBlock": { "nodes": [] }
      },
      {
        "type": "repeat",
        "times": 15,
        "timesVarKey": "单题最大等待轮数",
        "intervalMillis": 200,
        "comment": "主循环：每轮尝试匹配当前屏幕上的题目并作答；连续多轮无新题则退出",
        "block": {
          "nodes": [
            {
              "type": "set_var",
              "key": "命中题号",
              "value": -1,
              "comment": "本轮命中的题库题号，-1 表示未命中"
            },
            {
              "type": "set_var",
              "key": "已答命中数",
              "value": 0,
              "comment": "本轮视觉命中但已答过的题数（>0 说明屏幕上只有题库中已答过的题）"
            },
            {
              "type": "set_var",
              "key": "匹配索引",
              "value": 0,
              "comment": "题库遍历索引"
            },
            {
              "type": "repeat",
              "times": 1,
              "timesVarKey": "题库总数",
              "intervalMillis": 100,
              "comment": "遍历题库：找出当前屏幕上出现的、且未答过的题干",
              "block": {
                "nodes": [
                  {
                    "type": "set_var",
                    "key": "当前题干",
                    "value": { "kind": "expression", "expression": "split(题库题干, \"|\")[匹配索引]", "resultType": "TEXT" },
                    "comment": "取第 匹配索引 题的题干关键词（| 分隔还原数组）"
                  },
                  {
                    "type": "if",
                    "conditions": {
                      "mode": "ALL",
                      "items": [
                        {
                          "type": "vision",
                          "retryTimes": 1,
                          "retryIntervalMs": 300,
                          "condition": {
                            "type": "text_exists",
                            "left": 0, "top": 0, "right": 1080, "bottom": 2400,
                            "leftPct": 0.0, "topPct": 0.0, "rightPct": 1.0, "bottomPct": 1.0,
                            "text": "",
                            "textVarKey": "当前题干",
                            "minConfidence": 0.6
                          }
                        }
                      ]
                    },
                    "comment": "屏幕 OCR 命中该题干关键词",
                    "thenBlock": {
                      "nodes": [
                        {
                          "type": "if",
                          "varCondition": { "mode": "EXPRESSION", "expression": "!contains(split(已答列表, \"|\"), 当前题干)" },
                          "comment": "该题未答过 → 命中；已答过 → 计入已答命中数（用于判定题库是否已答完）",
                          "thenBlock": {
                            "nodes": [
                              {
                                "type": "set_var",
                                "key": "命中题号",
                                "value": { "kind": "expression", "expression": "匹配索引", "resultType": "NUMBER" }
                              },
                              { "type": "break" }
                            ]
                          },
                          "elseBlock": {
                            "nodes": [
                              { "type": "inc_var", "key": "已答命中数" },
                              { "type": "inc_var", "key": "匹配索引" }
                            ]
                          }
                        }
                      ]
                    },
                    "elseBlock": {
                      "nodes": [
                        { "type": "inc_var", "key": "匹配索引" }
                      ]
                    }
                  }
                ]
              }
            },
            {
              "type": "if",
              "varCondition": { "mode": "COMPARE", "key": "命中题号", "op": "GE", "value": "0" },
              "comment": "本地 OCR 匹配命中 → 作答并标记已答",
              "thenBlock": {
                "nodes": [
                  {
                    "type": "call_subflow",
                    "targetName": "作答题目",
                    "paramBindings": [ { "name": "命中题号", "value": "${命中题号}" } ]
                  },
                  {
                    "type": "set_var",
                    "key": "已答列表",
                    "value": { "kind": "expression", "expression": "已答列表 + \"|\" + split(题库题干, \"|\")[命中题号]", "resultType": "TEXT" },
                    "comment": "把该题题干关键词追加进已答列表（文本拼接）"
                  },
                  { "type": "set_var", "key": "连续未中", "value": 0 },
                  { "type": "set_var", "key": "连续已答轮数", "value": 0 }
                ]
              },
              "elseBlock": {
                "nodes": [
                  {
                    "type": "if",
                    "varCondition": { "mode": "COMPARE", "key": "已答命中数", "op": "GT", "value": "0" },
                    "comment": "屏幕上有题库的题但都已答过 → 判定题库是否已答完（不触发 AI 兜底）",
                    "thenBlock": {
                      "nodes": [
                        { "type": "set_var", "key": "连续未中", "value": 0, "comment": "已答命中不算未中，清零避免误触发 AI 兜底" },
                        { "type": "inc_var", "key": "连续已答轮数" },
                        {
                          "type": "if",
                          "varCondition": { "mode": "COMPARE", "key": "连续已答轮数", "op": "GE", "value": "2" },
                          "comment": "连续 2 轮屏幕上只有已答题 → 判定题库已答完，退出主循环",
                          "thenBlock": {
                            "nodes": [
                              { "type": "break" }
                            ]
                          },
                          "elseBlock": {
                            "nodes": [
                              {
                                "type": "action",
                                "action": { "type": "delay", "millis": 2000 },
                                "comment": "等待题目切换"
                              }
                            ]
                          }
                        }
                      ]
                    },
                    "elseBlock": {
                      "nodes": [
                        { "type": "inc_var", "key": "连续未中" },
                        {
                          "type": "if",
                          "varCondition": { "mode": "COMPARE", "key": "连续未中", "op": "GE", "value": "3" },
                          "comment": "连续多轮本地匹配失败 → 触发 AI 兜底读题",
                          "thenBlock": {
                            "nodes": [
                              { "type": "call_subflow", "targetName": "AI兜底读题" }
                            ]
                          },
                          "elseBlock": { "nodes": [] }
                        },
                        {
                          "type": "action",
                          "action": { "type": "delay", "millis": 2000 },
                          "comment": "未匹配到题，等待题目出现或界面切换"
                        }
                      ]
                    }
                  }
                ]
              }
            },
            {
              "type": "if",
              "varCondition": { "mode": "COMPARE", "key": "已处理题号", "op": "GE", "value": "0" },
              "comment": "AI 兜底命中了题 → 作答并标记已答",
              "thenBlock": {
                "nodes": [
                  {
                    "type": "call_subflow",
                    "targetName": "作答题目",
                    "paramBindings": [ { "name": "命中题号", "value": "${已处理题号}" } ]
                  },
                  {
                    "type": "set_var",
                    "key": "已答列表",
                    "value": { "kind": "expression", "expression": "已答列表 + \"|\" + split(题库题干, \"|\")[已处理题号]", "resultType": "TEXT" },
                    "comment": "把该题题干关键词追加进已答列表（文本拼接）"
                  },
                  { "type": "set_var", "key": "连续未中", "value": 0 },
                  { "type": "set_var", "key": "连续已答轮数", "value": 0 },
                  { "type": "set_var", "key": "已处理题号", "value": -1, "scope": "GLOBAL", "comment": "复位 AI 处理标记" }
                ]
              },
              "elseBlock": { "nodes": [] }
            }
          ]
        }
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "displayType": "NOTIFICATION",
          "title": "自动答题结束",
          "content": "题库已答完，或连续 ${单题最大等待轮数} 轮未匹配到新题（可能停留在非题目界面）"
        },
        "comment": "主循环退出后的结束提示"
      },
      {
        "type": "subflow_def",
        "name": "作答题目",
        "params": [
          { "name": "命中题号", "required": true, "description": "题库中的题号（0 起）" }
        ],
        "comment": "按题号取答案并作答：选择题点击选项文字，填空题剪贴板粘贴输入并提交",
        "block": {
          "nodes": [
            {
              "type": "set_var",
              "key": "当前答案",
              "value": { "kind": "expression", "expression": "split(题库答案, \"|\")[命中题号]", "resultType": "TEXT" },
              "comment": "取该题答案（选择题=选项文字，填空题=要输入的文本）"
            },
            {
              "type": "set_var",
              "key": "当前题型",
              "value": { "kind": "expression", "expression": "split(题库题型, \"|\")[命中题号]", "resultType": "TEXT" },
              "comment": "取该题题型：选择 / 填空"
            },
            {
              "type": "set_var",
              "key": "当前附加",
              "value": { "kind": "expression", "expression": "split(题库附加, \"|\")[命中题号]", "resultType": "TEXT" },
              "comment": "取该题附加文字（选择题=选项文字兜底，填空题=提交按钮文字）"
            },
            {
              "type": "if",
              "varCondition": { "mode": "COMPARE", "key": "当前题型", "op": "EQ", "value": "选择" },
              "comment": "选择题：逐一点击选项文字（# 分隔多个即为多选；优先附加列，其次答案列）",
              "thenBlock": {
                "nodes": [
                  {
                    "type": "set_var",
                    "key": "当前选项列表",
                    "value": { "kind": "expression", "expression": "if(当前附加 != \"\", 当前附加, 当前答案)", "resultType": "TEXT" },
                    "comment": "取选项文字列（附加列优先，否则答案列）；# 分隔多个即为多选题"
                  },
                  {
                    "type": "if",
                    "varCondition": { "mode": "COMPARE", "key": "当前选项列表", "op": "NE", "value": "" },
                    "comment": "有选项文字才点击（避免空文本误点）",
                    "thenBlock": {
                      "nodes": [
                        {
                          "type": "set_var",
                          "key": "选项个数",
                          "value": { "kind": "expression", "expression": "len(split(当前选项列表, \"#\"))", "resultType": "NUMBER" },
                          "comment": "选项个数（单选题=1，多选=按 # 分隔计数）"
                        },
                        { "type": "set_var", "key": "选项索引", "value": 0 },
                        {
                          "type": "repeat",
                          "times": 1,
                          "timesVarKey": "选项个数",
                          "intervalMillis": 500,
                          "comment": "多选核心：逐个点击每个选项文字",
                          "block": {
                            "nodes": [
                              {
                                "type": "set_var",
                                "key": "当前选项文字",
                                "value": { "kind": "expression", "expression": "trim(split(当前选项列表, \"#\")[选项索引])", "resultType": "TEXT" },
                                "comment": "取第 选项索引 个选项文字（去首尾空格）"
                              },
                              {
                                "type": "if",
                                "varCondition": { "mode": "COMPARE", "key": "当前选项文字", "op": "NE", "value": "" },
                                "thenBlock": {
                                  "nodes": [
                                    {
                                      "type": "action",
                                      "action": {
                                        "type": "click_text",
                                        "condition": {
                                          "type": "text_exists",
                                          "left": 0, "top": 0, "right": 1080, "bottom": 2400,
                                          "leftPct": 0.0, "topPct": 0.0, "rightPct": 1.0, "bottomPct": 1.0,
                                          "text": "",
                                          "textVarKey": "当前选项文字",
                                          "minConfidence": 0.6
                                        }
                                      },
                                      "config": { "retryTimes": 2, "retryIntervalMs": 600 },
                                      "comment": "点击当前选项文字"
                                    }
                                  ]
                                },
                                "elseBlock": { "nodes": [] }
                              },
                              { "type": "inc_var", "key": "选项索引" }
                            ]
                          }
                        },
                        {
                          "type": "action",
                          "action": { "type": "delay", "millis": 800 },
                          "comment": "等待点击生效"
                        }
                      ]
                    },
                    "elseBlock": { "nodes": [] }
                  }
                ]
              },
              "elseBlock": {
                "nodes": [
                  {
                    "type": "if",
                    "varCondition": { "mode": "COMPARE", "key": "当前附加", "op": "NE", "value": "" },
                    "comment": "填空题：附加列有提交按钮文字 → 粘贴答案后点击按钮",
                    "thenBlock": {
                      "nodes": [
                        {
                          "type": "action",
                          "action": {
                            "type": "no_control_input",
                            "inputText": "",
                            "inputTextVarKey": "当前答案",
                            "focusX": 540, "focusY": 2200, "focusXPct": 0.5, "focusYPct": 0.917,
                            "trigger": "TAP",
                            "doEnter": false,
                            "submitMode": "NONE"
                          },
                          "comment": "点击输入框坐标（不同 App 需改 focusX/focusY）并粘贴答案"
                        },
                        { "type": "action", "action": { "type": "delay", "millis": 500 } },
                        {
                          "type": "action",
                          "action": {
                            "type": "click_text",
                            "condition": {
                              "type": "text_exists",
                              "left": 0, "top": 0, "right": 1080, "bottom": 2400,
                              "leftPct": 0.0, "topPct": 0.0, "rightPct": 1.0, "bottomPct": 1.0,
                              "text": "",
                              "textVarKey": "当前附加",
                              "minConfidence": 0.6
                            }
                          },
                          "config": { "retryTimes": 2, "retryIntervalMs": 600 },
                          "comment": "点击提交按钮（附加列存按钮文字）"
                        }
                      ]
                    },
                    "elseBlock": {
                      "nodes": [
                        {
                          "type": "action",
                          "action": {
                            "type": "no_control_input",
                            "inputText": "",
                            "inputTextVarKey": "当前答案",
                            "focusX": 540, "focusY": 2200, "focusXPct": 0.5, "focusYPct": 0.917,
                            "trigger": "TAP",
                            "doEnter": true,
                            "submitMode": "ENTER_KEY"
                          },
                          "comment": "点击输入框、粘贴答案并回车提交"
                        }
                      ]
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      {
        "type": "subflow_def",
        "name": "AI兜底读题",
        "comment": "本地 OCR 匹配不到时：AI 大模型识别屏幕题目文本，再与题库题干模糊匹配（需 App 全局 AI 设置已配置）",
        "block": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "ai_vision",
                "prompt": "请识别当前屏幕上题目的完整文字内容，只输出题目原文本身，不要输出解释、JSON 或答案。",
                "regionMode": "FULL_SCREEN",
                "bindToVar": "AI题目文本",
                "timeoutMs": 30000
              },
              "comment": "AI 识别屏幕题目文本"
            },
            {
              "type": "action",
              "action": {
                "type": "run_code",
                "code": "// AI 识别出的题目文本 与 题库题干关键词 做包含匹配\nvar 屏幕题 = String(runtime.variables.get(\"AI题目文本\") || \"\");\nvar 题干 = String(runtime.variables.get(\"题库题干\") || \"\").split(\"|\");\nvar 命中 = -1;\nfor (var k = 0; k < 题干.length; k++) {\n  var ks = String(题干[k]).split(\"#\");\n  for (var m = 0; m < ks.length; m++) {\n    var kw = ks[m].trim();\n    if (kw && 屏幕题.indexOf(kw) >= 0) { 命中 = k; break; }\n  }\n  if (命中 >= 0) break;\n}\nruntime.variables.set(\"AI命中题号\", 命中);",
                "timeoutMs": 10000
              },
              "comment": "JS 模糊匹配：AI 题目文本包含题库题干关键词即命中"
            },
            {
              "type": "if",
              "varCondition": { "mode": "COMPARE", "key": "AI命中题号", "op": "GE", "value": "0" },
              "comment": "匹配到题 → 写入 GLOBAL 变量回传给主流程作答",
              "thenBlock": {
                "nodes": [
                  {
                    "type": "set_var",
                    "key": "已处理题号",
                    "value": { "kind": "expression", "expression": "AI命中题号", "resultType": "NUMBER" },
                    "scope": "GLOBAL"
                  }
                ]
              },
              "elseBlock": { "nodes": [] }
            }
          ]
        }
      }
    ]
  }
}
