{
  "id": "branch-conditions-001",
  "name": "条件分支与循环：if / 多分支 / 变量循环 / 视觉循环",
  "settings": {
    "runCount": 1,
    "defaultActionPreDelayMs": 1000,
    "defaultActionPostDelayMs": 0,
    "pauseOnRuntimeError": true
  },
  "baseScreenWidth": 1080,
  "baseScreenHeight": 2400,
  "root": {
    "nodes": [
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "条件分支与循环示例",
          "content": "依次演示：条件组（与/满足N项）、多分支匹配、变量循环、视觉循环。全部为安全动作，可直接运行观察变量变化。",
          "durationMs": 2500
        },
        "comment": "使用说明（本步可安全运行）"
      },
      {
        "type": "set_var",
        "key": "金币",
        "value": 1200,
        "scope": "LOCAL",
        "comment": "示例数字变量"
      },
      {
        "type": "set_var",
        "key": "状态",
        "value": "准备",
        "scope": "LOCAL",
        "comment": "示例文本变量，供多分支匹配"
      },
      {
        "type": "set_var",
        "key": "尝试",
        "value": 0,
        "scope": "LOCAL",
        "comment": "示例计数变量"
      },
      {
        "type": "if",
        "conditions": {
          "mode": "ALL",
          "items": [
            {
              "type": "variable",
              "key": "金币",
              "op": "GE",
              "value": "1000",
              "negated": false
            },
            {
              "type": "expression",
              "expression": "尝试 < 5"
            }
          ]
        },
        "thenBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "条件成立",
                "content": "金币≥1000 且 尝试<5 同时满足（条件组 ALL：与）。",
                "durationMs": 1200
              },
              "comment": "与条件全部满足时执行"
            }
          ]
        },
        "elseBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "条件不成立",
                "content": "至少有一个条件没满足。",
                "durationMs": 1200
              },
              "comment": "任一条件不满足时执行"
            }
          ]
        },
        "comment": "条件组 ALL（与）：变量条件 + 表达式条件"
      },
      {
        "type": "if",
        "conditions": {
          "mode": "N_OF",
          "requiredMatchCount": 2,
          "items": [
            {
              "type": "variable",
              "key": "金币",
              "op": "GT",
              "value": "500",
              "negated": false
            },
            {
              "type": "variable",
              "key": "尝试",
              "op": "LT",
              "value": "5",
              "negated": false
            },
            {
              "type": "expression",
              "expression": "contains(状态, \"准\")"
            }
          ]
        },
        "thenBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "满足 2 项",
                "content": "三个条件里至少满足了 2 项（N_OF：满足 N 个即可）。",
                "durationMs": 1200
              },
              "comment": "达到 requiredMatchCount 就执行"
            }
          ]
        },
        "elseBlock": {
          "nodes": [],
          "comment": "不满足时什么都不做（空块允许）"
        },
        "comment": "条件组 N_OF：满足 2 项即成立"
      },
      {
        "type": "var_switch",
        "key": "状态",
        "matchMode": "TEXT_EQUALS",
        "cases": [
          {
            "matchValue": "准备",
            "block": {
              "nodes": [
                {
                  "type": "action",
                  "action": {
                    "type": "prompt",
                    "title": "状态：准备",
                    "content": "当前状态是「准备」，可以做前置检查。",
                    "durationMs": 1200
                  },
                  "comment": "匹配到「准备」分支"
                }
              ]
            }
          },
          {
            "matchValue": "运行",
            "block": {
              "nodes": [
                {
                  "type": "action",
                  "action": {
                    "type": "prompt",
                    "title": "状态：运行",
                    "content": "当前状态是「运行」，做正式动作。",
                    "durationMs": 1200
                  },
                  "comment": "匹配到「运行」分支"
                }
              ]
            }
          }
        ],
        "defaultBlock": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "其它状态",
                "content": "状态既不等于「准备」也不等于「运行」，走默认分支。",
                "durationMs": 1200
              },
              "comment": "都不匹配时执行"
            }
          ]
        },
        "comment": "多分支匹配：按变量的文本取值分流（TEXT_EQUALS / TEXT_CONTAINS / NUMBER_EQUALS）"
      },
      {
        "type": "while_var",
        "key": "金币",
        "op": "LT",
        "value": 1500,
        "block": {
          "nodes": [
            {
              "type": "inc_var",
              "key": "金币",
              "delta": 100.0,
              "scope": "LOCAL",
              "comment": "每轮加 100"
            },
            {
              "type": "inc_var",
              "key": "尝试",
              "delta": 1.0,
              "scope": "LOCAL",
              "comment": "轮次计数"
            },
            {
              "type": "action",
              "action": {
                "type": "delay",
                "millis": 100
              },
              "comment": "每轮稍作停顿，便于控制台观察"
            }
          ]
        },
        "intervalMillis": 200,
        "maxIterations": 10,
        "comment": "变量循环：金币<1500 时持续加 100，最多 10 轮（护栏防死循环）"
      },
      {
        "type": "while_vision",
        "condition": {
          "type": "text_exists",
          "left": 0,
          "top": 0,
          "right": 1080,
          "bottom": 2400,
          "leftPct": 0.0,
          "topPct": 0.0,
          "rightPct": 1.0,
          "bottomPct": 1.0,
          "text": "胜利"
        },
        "block": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "识别到关键字",
                "content": "屏幕上出现了「胜利」，说明视觉循环可以收尾了。",
                "durationMs": 800
              },
              "comment": "条件成立时执行"
            }
          ]
        },
        "intervalMillis": 500,
        "timeoutMillis": 3000,
        "maxIterations": 3,
        "comment": "视觉循环：屏幕上出现「胜利」就执行块内动作；最多 3 轮 / 3 秒超时（护栏）"
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "示例结束",
          "content": "金币=${金币}，尝试=${尝试}，状态=${状态}（可在控制台观察同名变量）",
          "durationMs": 2000
        },
        "comment": "结束提示：Prompt 的 title/content 支持 ${变量} 模板插值"
      }
    ]
  }
}
