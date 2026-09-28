{
  "id": "vision-loop-retry-001",
  "name": "图色识别循环重试：等待目标出现并点击",
  "settings": {
    "runCount": 1,
    "defaultActionPreDelayMs": 1000,
    "defaultActionPostDelayMs": 0,
    "pauseOnRuntimeError": true
  },
  "baseScreenWidth": 1080,
  "baseScreenHeight": 2362,
  "root": {
    "nodes": [
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "图色循环重试示例",
          "content": "结构：等目标出现 → 识别后点击 → 校验是否进入 → 失败回跳重试（限 3 轮）。模板图为空，请先在你的设备上截取目标后再填充；真实点击默认禁用。",
          "durationMs": 2500
        },
        "comment": "使用说明（本步可安全运行）"
      },
      {
        "type": "set_var",
        "key": "轮次",
        "value": 0,
        "scope": "LOCAL",
        "comment": "已完成轮数，可在控制台观察"
      },
      {
        "type": "set_var",
        "key": "目标坐标",
        "value": "",
        "scope": "LOCAL",
        "comment": "识别命中的坐标（由等待识别写入，格式 x,y）"
      },
      {
        "type": "set_var",
        "key": "命中数量",
        "value": 0,
        "scope": "LOCAL",
        "comment": "命中数量（由等待识别写入）"
      },
      {
        "type": "repeat",
        "times": 3,
        "intervalMillis": 300,
        "comment": "最多 3 轮；轮次用完即结束，避免无限循环",
        "block": {
          "nodes": [
            {
              "type": "label",
              "name": "重试入口",
              "comment": "本轮入口：识别超时、或校验不通过，都会回到这里"
            },
            {
              "type": "action",
              "action": {
                "type": "wait_for_vision",
                "condition": {
                  "type": "template_match",
                  "templateBase64": "",
                  "templateBaseScreenWidth": 1080,
                  "templateBaseScreenHeight": 2362,
                  "left": 0,
                  "top": 0,
                  "right": 0,
                  "bottom": 0,
                  "leftPct": 0.0,
                  "topPct": 0.0,
                  "rightPct": 0.0,
                  "bottomPct": 0.0,
                  "similarity": 0.85
                },
                "timeoutMillis": 5000,
                "outputs": {
                  "pointVar": "目标坐标",
                  "hitCountVar": "命中数量",
                  "scoreVar": "相似度"
                }
              },
              "config": {
                "retryTimes": 1,
                "retryIntervalMs": 300,
                "events": {
                  "onTimeout": {
                    "name": "超时",
                    "targetType": "LABEL",
                    "labelTarget": "重试入口"
                  }
                }
              },
              "comment": "等目标出现；识别不到就回跳「重试入口」（事件超时 → 标签）"
            },
            {
              "type": "block",
              "block": {
                "nodes": [
                  {
                    "type": "action",
                    "enabled": false,
                    "action": {
                      "type": "click_image",
                      "condition": {
                        "type": "template_match",
                        "templateBase64": "",
                        "templateBaseScreenWidth": 1080,
                        "templateBaseScreenHeight": 2362,
                        "left": 0,
                        "top": 0,
                        "right": 0,
                        "bottom": 0,
                        "leftPct": 0.0,
                        "topPct": 0.0,
                        "rightPct": 0.0,
                        "bottomPct": 0.0,
                        "similarity": 0.85
                      },
                      "outputs": {
                        "pointVar": "目标坐标"
                      }
                    },
                    "config": {
                      "preDelayMs": 500
                    },
                    "comment": "识别到目标就点它：填入自己的模板图后启用这一步"
                  }
                ]
              },
              "config": {
                "runtimeConditions": {
                  "items": [
                    {
                      "type": "vision",
                      "condition": {
                        "type": "template_match",
                        "templateBase64": "",
                        "templateBaseScreenWidth": 1080,
                        "templateBaseScreenHeight": 2362,
                        "left": 0,
                        "top": 0,
                        "right": 0,
                        "bottom": 0,
                        "leftPct": 0.0,
                        "topPct": 0.0,
                        "rightPct": 0.0,
                        "bottomPct": 0.0,
                        "similarity": 0.85
                      }
                    }
                  ]
                },
                "conditionMissStrategy": "FAIL",
                "jumpTargetOnFail": "重试入口",
                "failTargetType": "LABEL"
              },
              "comment": "运行条件：目标必须仍在屏幕上才执行本块；否则按失败策略跳回「重试入口」"
            },
            {
              "type": "inc_var",
              "key": "轮次",
              "delta": 1.0,
              "scope": "LOCAL",
              "comment": "本轮到次，计数 +1"
            }
          ]
        }
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "循环结束",
          "content": "轮次=${轮次}，目标坐标=${目标坐标}，命中数量=${命中数量}（可在控制台观察同名变量）",
          "durationMs": 2000
        },
        "comment": "结束提示：Prompt 的 title/content 支持 ${变量} 模板插值"
      }
    ]
  }
}
