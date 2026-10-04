{
  "id": "color-multi-point-001",
  "name": "多点比色与多点找色示范",
  "baseScreenWidth": 1080,
  "baseScreenHeight": 2400,
  "settings": {
    "runCount": 1,
    "defaultActionPreDelayMs": 300,
    "defaultActionPostDelayMs": 0,
    "pauseOnRuntimeError": true
  },
  "root": {
    "nodes": [
      {
        "type": "set_var",
        "comment": "初始化：点击次数（多变量合并写法见 examples/variables-batch-items-001.axs）",
        "key": "",
        "value": "",
        "items": [
          { "type": "set", "key": "点击次数", "value": 0, "scope": "LOCAL" },
          { "type": "set", "key": "命中数量", "value": 0, "scope": "LOCAL" }
        ]
      },
      {
        "type": "if",
        "comment": "① 多点比色（color_at + points）：锚点命中，且三个「相对锚点偏移」的采样点全部命中 → 认定是目标界面（单像素偶然命中不算）",
        "conditions": {
          "mode": "ALL",
          "items": [
            {
              "type": "vision",
              "retryTimes": 2,
              "retryIntervalMs": 300,
              "condition": {
                "type": "color_at",
                "x": 540,
                "y": 1200,
                "xPct": 0.5,
                "yPct": 0.5,
                "color": -14575885,
                "tolerance": 20,
                "pointsMatchMode": "ALL",
                "points": [
                  { "dx": 0, "dy": -40, "color": -1, "tolerance": 20 },
                  { "dx": 0, "dy": 40, "color": -16777216 },
                  { "dxPct": 0.04, "dyPct": 0, "color": -1 }
                ]
              }
            }
          ]
        },
        "thenBlock": { "nodes": [] },
        "elseBlock": { "nodes": [] }
      },
      {
        "type": "action",
        "id": "find_target",
        "comment": "② 多点找色（color_region + matchMode=FIND_TARGETS + points）：在识别区域内按 sampleStep 扫描，命中「主色 + 各偏移采样点」的位置；命中点写进变量供点击用",
        "action": {
          "type": "wait_for_vision",
          "condition": {
            "type": "color_region",
            "left": 200,
            "top": 800,
            "right": 880,
            "bottom": 1600,
            "leftPct": 0.185,
            "topPct": 0.333,
            "rightPct": 0.815,
            "bottomPct": 0.667,
            "color": -14575885,
            "tolerance": 20,
            "matchMode": "FIND_TARGETS",
            "sampleStep": 4,
            "findDirection": "TOP_LEFT",
            "pointsMatchMode": "ALL",
            "points": [
              { "dx": 0, "dy": -30, "color": -1 },
              { "dx": 30, "dy": 0, "color": -16777216 }
            ]
          },
          "timeoutMillis": 3000,
          "outputs": {
            "pointVar": "找到的点",
            "boxVar": "找到的框",
            "hitCountVar": "命中数量"
          }
        },
        "config": {
          "events": {
            "onTimeout": {
              "name": "找色超时",
              "targetType": "LABEL",
              "labelTarget": "结束"
            }
          }
        }
      },
      {
        "type": "if",
        "comment": "③ 用找色结果决定是否点击：命中数量 >= 1 才点（找色时附加颜色是「锚点色候选」，同画面多目标由 findDirection 决定先返回哪一个）",
        "conditions": {
          "mode": "ALL",
          "items": [
            { "type": "variable", "key": "命中数量", "op": "GE", "value": "1" }
          ]
        },
        "thenBlock": {
          "nodes": [
            {
              "type": "action",
              "comment": "点击命中点：pointVarKey 直接读多点找色写出的坐标（无命中时回落静态坐标）",
              "action": {
                "type": "tap",
                "x": 540,
                "y": 1200,
                "xPct": 0.5,
                "yPct": 0.5,
                "pointVarKey": "找到的点",
                "duration": 60
              }
            },
            {
              "type": "inc_var",
              "comment": "点击次数 +1（单变量直写；多变量合并写法见 items 示范样例）",
              "key": "点击次数",
              "delta": 1,
              "scope": "LOCAL"
            }
          ]
        },
        "elseBlock": { "nodes": [] }
      },
      { "type": "label", "name": "结束" }
    ]
  }
}
