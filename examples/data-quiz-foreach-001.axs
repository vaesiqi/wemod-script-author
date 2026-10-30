{
  "sampleMeta": {
    "title": "遍历循环：题库逐题比对（命中即跳出）",
    "summary": "读题库按行 → foreach 逐题取题干与答案 → 屏幕出现题干就点答案并 break。演示\"每轮多步动作 + 循环体内 break 冒泡\"。",
    "category": "数据驱动",
    "tags": [
      "遍历循环",
      "foreach",
      "题库",
      "自动答题",
      "break",
      "OCR",
      "splitPick"
    ],
    "safeToRun": false,
    "needsReview": true
  },
  "id": "sample_foreach_quiz_compare",
  "name": "示例：遍历循环-题库逐题比对（命中即跳出）",
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
      "defaultValue": "./res/data/qa.txt",
      "enabled": true,
      "order": 0
    }
  ],
  "root": {
    "nodes": [
      {
        "type": "action",
        "action": {
          "type": "file_action",
          "op": "READ",
          "path": "",
          "pathVarKey": "题库文件路径",
          "encoding": "UTF-8",
          "bindToVar": "题库行",
          "parseMode": "LINES"
        },
        "comment": "① 读题库：按行解析成数组（一项一行）"
      },
      {
        "type": "foreach",
        "listExpr": "题库行",
        "itemVar": "当前行",
        "indexVar": "当前题号",
        "intervalMillis": 0,
        "maxIterations": 5000,
        "comment": "② 遍历循环：逐题比对。命中就作答并 break（跳出整个遍历）",
        "block": {
          "nodes": [
            {
              "type": "set_var",
              "key": "当前题干",
              "value": {
                "kind": "expression",
                "expression": "splitPick(当前行, \"|\", 0)",
                "resultType": "TEXT"
              },
              "comment": "取第 1 列题干"
            },
            {
              "type": "set_var",
              "key": "当前答案",
              "value": {
                "kind": "expression",
                "expression": "splitPick(当前行, \"|\", 1)",
                "resultType": "TEXT"
              },
              "comment": "取第 2 列答案"
            },
            {
              "type": "if",
              "conditions": {
                "mode": "ALL",
                "items": [
                  {
                    "type": "vision",
                    "retryTimes": 0,
                    "retryIntervalMs": 200,
                    "condition": {
                      "type": "text_exists",
                      "left": 0,
                      "top": 0,
                      "right": 1080,
                      "bottom": 2400,
                      "leftPct": 0,
                      "topPct": 0,
                      "rightPct": 1,
                      "bottomPct": 1,
                      "text": "",
                      "textVarKey": "当前题干",
                      "textCompareMode": "CONTAINS"
                    }
                  }
                ]
              },
              "comment": "屏幕上出现这道题的题干 → 作答",
              "thenBlock": {
                "nodes": [
                  {
                    "type": "action",
                    "action": {
                      "type": "click_text",
                      "condition": {
                        "type": "text_exists",
                        "left": 0,
                        "top": 0,
                        "right": 1080,
                        "bottom": 2400,
                        "leftPct": 0,
                        "topPct": 0,
                        "rightPct": 1,
                        "bottomPct": 1,
                        "text": "",
                        "textVarKey": "当前答案"
                      },
                      "config": {
                        "retryTimes": 2,
                        "retryIntervalMs": 600
                      }
                    },
                    "comment": "按答案文字点选项"
                  },
                  {
                    "type": "break",
                    "comment": "命中即跳出遍历（forEach 会消费 break）"
                  }
                ]
              },
              "elseBlock": {
                "nodes": []
              }
            }
          ]
        }
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "displayType": "SIMPLE",
          "title": "答题完成",
          "content": "已按第 ${当前题号} 题作答（题号从 0 开始）"
        },
        "comment": "③ 遍历结束后提示（当前题号由 indexVar 写入）"
      }
    ]
  }
}
