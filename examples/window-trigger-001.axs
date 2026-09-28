{
  "id": "window-trigger-001",
  "name": "界面触发：指定界面出现指定文字时执行",
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
        "name": "处理界面变化",
        "params": [],
        "block": {
          "nodes": [
            {
              "type": "action",
              "action": {
                "type": "prompt",
                "title": "界面出现目标文字",
                "content": "事件来源=${event_reason}；来源应用=${event_action}",
                "durationMs": 1800
              },
              "comment": "事件变量都在：event_name / event_action / event_reason"
            },
            {
              "type": "inc_var",
              "key": "命中次数",
              "delta": 1.0,
              "scope": "GLOBAL",
              "comment": "跨子流程累加要写 GLOBAL（LOCAL 在子流程返回时回滚）"
            }
          ]
        },
        "comment": "界面出现目标文字时执行的流程"
      },
      {
        "type": "set_var",
        "key": "命中次数",
        "value": 0,
        "scope": "GLOBAL",
        "comment": "统计命中多少次"
      },
      {
        "type": "event_listener",
        "eventName": "onWindowChanged",
        "source": "WINDOW",
        "filterPackage": "",
        "filterTitleContains": "",
        "filterTextContains": "支付成功",
        "filterClassName": "",
        "targetType": "SUB_FLOW",
        "targetSubFlow": "处理界面变化",
        "async": true,
        "writeEventToVars": true,
        "comment": "界面文字出现「支付成功」时执行；包名留空=所有应用（建议填上以减少无关触发）；需要无障碍服务"
      },
      {
        "type": "action",
        "action": {
          "type": "prompt",
          "title": "监听已就绪",
          "content": "已开始监听界面变化：界面出现「支付成功」时执行子流程，可在控制台查看「命中次数」。",
          "durationMs": 2000
        },
        "comment": "使用说明：本示例需要先开启无障碍服务"
      },
      {
        "type": "action",
        "action": {
          "type": "delay",
          "millis": 30000
        },
        "comment": "保持运行 30 秒等待界面变化；实际使用可改成循环或延长"
      }
    ]
  }
}
