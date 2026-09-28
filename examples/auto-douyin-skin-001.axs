{
  "id": "auto-douyin-skin-001",
  "name": "自动刷抖音-肤色判定点赞收藏",
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
      "key": "刷视频数",
      "label": "刷视频数量",
      "valueType": "数字",
      "controlType": "NUMBER",
      "defaultValue": "50",
      "minValue": 1,
      "maxValue": 500,
      "stepValue": 1,
      "enabled": true,
      "order": 0
    },
    {
      "key": "已点赞数",
      "label": "本次已点赞收藏数(只读)",
      "valueType": "数字",
      "controlType": "NUMBER",
      "defaultValue": "0",
      "readOnly": true,
      "enabled": true,
      "order": 1
    }
  ],
  "root": {
    "nodes": [
      {
        "type": "set_var",
        "key": "已点赞数",
        "value": 0,
        "scope": "GLOBAL",
        "comment": "初始化点赞计数(写GLOBAL以同步控制台只读显示)"
      },
      {
        "type": "action",
        "action": { "type": "open_app", "packageName": "com.ss.android.ugc.aweme" },
        "comment": "打开抖音"
      },
      {
        "type": "action",
        "action": { "type": "ensure_screen_on", "wakeLockDurationMs": 60000 },
        "comment": "保持屏幕常亮"
      },
      {
        "type": "action",
        "action": { "type": "delay", "millis": 4000 },
        "comment": "等待抖音启动进入推荐流"
      },
      {
        "type": "repeat",
        "times": 50,
        "timesVarKey": "刷视频数",
        "intervalMillis": 100,
        "comment": "主循环：刷 N 个视频",
        "block": {
          "nodes": [
            {
              "type": "action",
              "action": { "type": "delay", "millis": 2500 },
              "comment": "等待当前视频画面加载稳定后再判定"
            },
            {
              "type": "if",
              "comment": "肤色判定：画面肤色采样占比>=20%即视为人像画面(可调 hitRatio)",
              "conditions": {
                "mode": "ALL",
                "items": [
                  {
                    "type": "vision",
                    "retryTimes": 2,
                    "retryIntervalMs": 400,
                    "condition": {
                      "type": "color_region",
                      "left": 0,
                      "top": 0,
                      "right": 1080,
                      "bottom": 2400,
                      "leftPct": 0.0,
                      "topPct": 0.05,
                      "rightPct": 1.0,
                      "bottomPct": 0.95,
                      "color": -2183028,
                      "tolerance": 30,
                      "sampleStep": 10,
                      "sampleMode": "GRID",
                      "matchMode": "REGION_MATCH",
                      "hitRatio": 0.2,
                      "requireAverageMatch": false
                    }
                  }
                ]
              },
              "thenBlock": {
                "nodes": [
                  {
                    "type": "action",
                    "id": "like_btn",
                    "comment": "点赞：优先无障碍节点查找，找不到坐标兜底(节点成功跳过后置标签，失败跳坐标标签)",
                    "action": {
                      "type": "node_click",
                      "selector": { "description": "点赞", "descriptionMode": "CONTAINS" }
                    },
                    "config": {
                      "onSuccess": "GOTO",
                      "successTargetType": "LABEL",
                      "jumpTargetOnSuccess": "after_like",
                      "onFail": "GOTO",
                      "failTargetType": "LABEL",
                      "jumpTargetOnFail": "like_coord"
                    }
                  },
                  { "type": "label", "name": "like_coord" },
                  {
                    "type": "action",
                    "comment": "点赞坐标兜底(1080x2400基准右侧栏，不同机型需在JSON里调整)",
                    "action": { "type": "tap", "x": 975, "y": 950, "xPct": 0.903, "yPct": 0.396 },
                    "config": { "coordJitterMinPx": 2, "coordJitterMaxPx": 4 }
                  },
                  { "type": "label", "name": "after_like" },
                  {
                    "type": "action",
                    "id": "fav_btn",
                    "comment": "收藏：优先无障碍节点查找，失败坐标兜底",
                    "action": {
                      "type": "node_click",
                      "selector": { "description": "收藏", "descriptionMode": "CONTAINS" }
                    },
                    "config": {
                      "onSuccess": "GOTO",
                      "successTargetType": "LABEL",
                      "jumpTargetOnSuccess": "after_fav",
                      "onFail": "GOTO",
                      "failTargetType": "LABEL",
                      "jumpTargetOnFail": "fav_coord"
                    }
                  },
                  { "type": "label", "name": "fav_coord" },
                  {
                    "type": "action",
                    "comment": "收藏坐标兜底(右侧栏星形按钮)",
                    "action": { "type": "tap", "x": 975, "y": 1120, "xPct": 0.903, "yPct": 0.467 },
                    "config": { "coordJitterMinPx": 2, "coordJitterMaxPx": 4 }
                  },
                  { "type": "label", "name": "after_fav" },
                  {
                    "type": "set_var",
                    "comment": "点赞收藏计数+1",
                    "key": "已点赞数",
                    "value": {
                      "kind": "expression",
                      "expression": "已点赞数 + 1",
                      "resultType": "NUMBER"
                    },
                    "scope": "GLOBAL"
                  }
                ]
              },
              "elseBlock": { "nodes": [] }
            },
            {
              "type": "action",
              "comment": "上滑切到下一个视频",
              "action": {
                "type": "swipe",
                "fromX": 540, "fromY": 1900, "toX": 540, "toY": 550,
                "fromXPct": 0.5, "fromYPct": 0.79, "toXPct": 0.5, "toYPct": 0.23,
                "duration": 300
              }
            }
          ]
        }
      },
      {
        "type": "action",
        "comment": "刷完提示",
        "action": {
          "type": "prompt",
          "displayType": "NOTIFICATION",
          "title": "刷视频完成",
          "content": "共刷完 ${刷视频数} 个视频，点赞收藏 ${已点赞数} 次"
        }
      }
    ]
  }
}
