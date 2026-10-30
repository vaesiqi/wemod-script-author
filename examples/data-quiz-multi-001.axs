{
  "sampleMeta": {
    "title": "自动答题：多选题（答案列 # 分隔，逐个点选）",
    "summary": "题库答案列用 # 分隔多个选项（如 苹果#香蕉）→ 一步拆成选项数组 → 遍历循环逐个点选，最后按需点提交按钮。单选也适用（只有一项时就点一次）。",
    "category": "数据驱动",
    "tags": [
      "多选",
      "题库",
      "自动答题",
      "遍历循环",
      "foreach",
      "findContains",
      "splitPick",
      "lines",
      "replace"
    ],
    "safeToRun": false,
    "needsReview": true
  },
  "id": "sample_quiz_multi_answer",
  "name": "示例：自动答题-多选题（逐个点选）",
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
      "description": "项目模式下用 ./res/data/qa.txt；单脚本可填应用私有目录或 SAF 授权后的 content:// 路径",
      "enabled": true,
      "order": 0
    },
    {
      "key": "题干关键词",
      "label": "题干关键词（可换成 OCR 写出的变量名）",
      "valueType": "文本",
      "controlType": "TEXT",
      "defaultValue": "",
      "description": "屏幕上出现的题干片段。前面若有「文字识别」把屏幕文本写进变量，这里填那个变量名即可",
      "enabled": true,
      "order": 1
    },
    {
      "key": "提交按钮文字",
      "label": "提交按钮文字（留空=不点，边点边判的 App 保持为空）",
      "valueType": "文本",
      "controlType": "TEXT",
      "defaultValue": "确定",
      "description": "多选点完选项后常需要点「确定/提交」；你的 App 点完即自动判题就留空",
      "enabled": true,
      "order": 2
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
        "comment": "① 读题库：按行解析，一行一题（题干|答案，答案列可用 # 分隔多个选项）"
      },
      {
        "type": "set_var",
        "key": "命中行",
        "value": {
          "kind": "expression",
          "expression": "findContains(题库行, 题干关键词)",
          "resultType": "TEXT"
        },
        "comment": "② 一步找到题干所在行（OCR 容错可换成 findLike(题库行, 题干关键词, 0.8)）"
      },
      {
        "type": "set_var",
        "key": "答案列",
        "value": {
          "kind": "expression",
          "expression": "splitPick(命中行, \"|\", 1)",
          "resultType": "TEXT"
        },
        "comment": "③ 取答案列：单选是「苹果」，多选是「苹果#香蕉」"
      },
      {
        "type": "foreach",
        "listExpr": "lines(replace(答案列, \"#\", \"\\n\"))",
        "itemVar": "当前选项",
        "indexVar": "选项序号",
        "intervalMillis": 500,
        "maxIterations": 20,
        "comment": "④ 多选核心：把 # 换成换行再按行拆 → 选项数组（自动去空行）；单选只有一项，同样点一次。间隔 500ms 防止连点被吞",
        "block": {
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
                  "textVarKey": "当前选项",
                  "textCompareMode": "CONTAINS"
                },
                "config": { "retryTimes": 2, "retryIntervalMs": 500 }
              },
              "comment": "按选项文字点选（文字来自变量；选项带编号前缀时，题库里写完整文字）"
            }
          ]
        }
      },
      {
        "type": "if",
        "varCondition": { "mode": "COMPARE", "key": "提交按钮文字", "op": "NE", "value": "" },
        "comment": "⑤ 需要点提交才点（「提交按钮文字」留空则跳过，适配点完即自动判题的 App）",
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
                  "textVarKey": "提交按钮文字"
                },
                "config": { "retryTimes": 2, "retryIntervalMs": 500 }
              }
            }
          ]
        },
        "elseBlock": { "nodes": [] }
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "displayType": "SIMPLE",
          "title": "作答完成",
          "content": "命中行：${命中行}\n答案列：${答案列}"
        },
        "comment": "⑥ 结束提示（便于第一次调题库格式时对照）"
      }
    ]
  }
}
