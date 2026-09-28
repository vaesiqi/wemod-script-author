{
  "id": "notification-trigger-001",
  "name": "通知触发：收到指定内容的通知时执行子流程",
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
        "type": "subflow_def",
        "name": "处理通知",
        "params": [],
        "block": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "收到通知",
                "content": "事件来源=${event_reason}；来源应用=${event_action}",
                "durationMs": 2000
              },
              "comment": "事件参数已写进变量：event_name / event_action / event_reason"
            },
            {
              "type": "inc_var",
              "key": "通知次数",
              "delta": 1.0,
              "scope": "GLOBAL",
              "comment": "跨子流程累加必须写 GLOBAL（子流程返回时 LOCAL 会回滚）"
            }
          ]
        },
        "comment": "被通知事件触发的处理流程"
      },
      {
        "type": "set_var",
        "key": "通知次数",
        "value": 0,
        "scope": "GLOBAL",
        "comment": "统计收到了多少次匹配的通知"
      },
      {
        "type": "event_listener",
        "eventName": "onNotification",
        "source": "NOTIFICATION",
        "filterPackage": "",
        "filterTitleContains": "",
        "filterTextContains": "验证码",
        "targetType": "SUB_FLOW",
        "targetSubFlow": "处理通知",
        "async": true,
        "writeEventToVars": true,
        "comment": "收到「内容包含 验证码」的通知时执行子流程；包名留空=所有应用（可改成指定应用减少无关触发）"
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "监听已就绪",
          "content": "已开始监听通知：收到含「验证码」的通知会执行子流程，可在控制台查看「通知次数」。",
          "durationMs": 2000
        },
        "comment": "使用说明：本示例需要先在系统设置里为 WeMod 打开「通知使用权」"
      },
      {
        "type": "action",
        "action": {
          "type": "delay",
          "millis": 30000
        },
        "comment": "保持运行 30 秒等待通知；实际使用可改成循环或延长"
      }
    ]
  }
}
