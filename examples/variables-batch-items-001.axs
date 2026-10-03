{
  "id": "variables-batch-items-001",
  "name": "变量批量操作-items 示范",
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
        "comment": "① 一次定义全部统计变量（1 个节点 + items，推荐写法；顺序即执行顺序）",
        "key": "",
        "value": "",
        "items": [
          { "type": "set", "key": "轮次", "value": 0, "scope": "LOCAL" },
          { "type": "set", "key": "成功次数", "value": 0, "scope": "LOCAL" },
          { "type": "set", "key": "失败原因", "value": "无", "scope": "LOCAL" },
          { "type": "set", "key": "记录", "value": [], "scope": "LOCAL" },
          {
            "type": "set",
            "key": "汇总文本",
            "value": { "kind": "expression", "expression": "\"计划 \" + text(3) + \" 轮\"", "resultType": "TEXT" },
            "scope": "LOCAL"
          }
        ]
      },
      {
        "type": "while_var",
        "comment": "② 循环里每轮批量自增多个计数器（同样是 1 个节点 + items）",
        "key": "轮次",
        "op": "LT",
        "value": 3,
        "maxIterations": 50,
        "intervalMillis": 100,
        "block": {
          "nodes": [
            {
              "type": "inc_var",
              "comment": "批量自增：轮次 +1、成功次数 +1",
              "key": "",
              "items": [
                { "type": "inc", "key": "轮次", "delta": 1, "scope": "LOCAL" },
                { "type": "inc", "key": "成功次数", "delta": 1, "scope": "LOCAL" }
              ]
            },
            {
              "type": "action",
              "comment": "占位业务动作（真实脚本在这里放点击/滑动/识别等）",
              "action": { "type": "delay", "millis": 200 }
            },
            {
              "type": "set_var",
              "comment": "③ 同一节点混用 set / inc / get（条目级 type）：拷一份汇总、重置失败原因、再自增一次",
              "key": "",
              "value": "",
              "items": [
                { "type": "get", "sourceKey": "汇总文本", "key": "上一轮汇总", "scope": "LOCAL" },
                { "type": "set", "key": "失败原因", "value": "无", "scope": "LOCAL" },
                { "type": "inc", "key": "成功次数", "delta": 1, "scope": "LOCAL" }
              ]
            },
            {
              "type": "if",
              "comment": "用汇总变量判断（演示批量写入的变量可被条件引用）",
              "conditions": {
                "mode": "ALL",
                "items": [
                  { "type": "expression", "expression": "成功次数 >= number(1)" }
                ]
              },
              "thenBlock": { "nodes": [] },
              "elseBlock": { "nodes": [] }
            }
          ]
        }
      },
      {
        "type": "set_var",
        "comment": "④ 结果落到全局变量（跨子流程/跨脚本回传才需要 GLOBAL；作用域在条目级指定）",
        "key": "",
        "value": "",
        "items": [
          {
            "type": "set",
            "key": "本轮结果",
            "value": { "kind": "expression", "expression": "汇总文本 + \" / 成功 \" + text(成功次数)", "resultType": "TEXT" },
            "scope": "GLOBAL"
          }
        ]
      }
    ]
  }
}
