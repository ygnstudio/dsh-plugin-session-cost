# 实现与接口

## 用量与账本

- `sessionCost` 是纯投影：统计主会话的 `assistant/commit` 和 `assistant/attempt`。失败尝试优先使用已提交 usage，否则取 compact stream 最后一个 usage，避免重复计费。
- 最近调用账号按投影的当前 provider 匹配；多个账号时请设置供应商绑定。
- 账本按真实 `Session.id` 保存费用和调用次数增量，重启后去重。热加载到正在进行的会话时，先建立基线，避免把历史总费用计入今天。
- 老版本 `[object Object]` 等无法验证的记录保留在文件中，并从今日、近 7 天统计排除，面板有明确提示。不会伪造历史归属。
- 费用是估算，不是账单。自动命名等辅助模型调用不在主会话用量里；节假日沿用普通工作日价格规则。跨会话面板累计目前仅聚合 CNY。
- 官方价格页：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>。启动与每天刷新，失败保留已有表；面板只读本地缓存，避免打开面板触发网络抓取。

## 账号与数据

运行数据位于 `${DSH_HOME:-~/.dsh}/plugin-data/session-cost/`，包括 `accounts.json`、`pricing.json`、`ledger.jsonl`。目录权限 0700，文件 0600，JSON 通过同目录临时文件原子替换。

首次加载复制插件目录中的旧数据，保留原件，以 `.migration-v1.json` 防止后续重置又导入旧数据。不要把运行数据打进安装包。

DeepSeek 登录账号通过 Host `deepseekAccount` 服务读取；导入的 DSH key 保存引用，每次查询通过 `credentials.resolve` 解析。手动输入的 key 仅保存在本机私有文件，不返回给客户端。WorkBuddy 的本机查询改为异步子进程，并有超时与缓存。第三方套餐接口属于适配器能力，上游变更时可能需要更新；没有覆盖所有厂商的真实账号验证。

后台每 5 分钟刷新启用的账号，最大并发 2；同账号查询合并，结果只合并进仍存在且身份未变化的当前配置。已删除账号和新密钥不会被晚到的结果覆盖。

## 接口

所有精确路由先经过 DSH `connection.admit`，与官方 API 一样校验 Host、Origin 和登录状态。写入要求 JSON，正文最多 64 KiB，读取正文最多 10 秒。

| 路径前缀 `/api/session-cost` | 方法 | 说明 |
| --- | --- | --- |
| `/accounts` | GET / PUT | GET 返回脱敏账号与 revision；PUT 传 `{revision, accounts}`，旧版本返回 409 |
| `/accounts/query` | POST | `{id}` 查询已有账号并合并快照 |
| `/accounts/test` | POST | 测试草稿；传 `accountId` 可在 key 留空时使用已保存凭据 |
| `/accounts/local-logins` | GET | 本机账号与可导入凭据引用；不阻塞设置页首屏 |
| `/ledger` | GET | 今日、近 7 天、最近 200 条已校验记录、legacyRows |
| `/pricing` | GET / PUT | 单价缓存；PUT 仅修改 warnBalanceBelow |
| `/pricing/refresh` | POST | 重新抓取，合并并发并限制刷新频率 |

## 界面与响应

设置页和面板共享缓存。查询有即时状态、超时、重试和卸载取消；保存失败保留编辑内容；旧查询不覆盖新版本。系统通知只在用户点击「开启系统通知」时申请。零余额、负余额仍会触发低余额状态。

面板采用浏览器顶层浮层，避免宿主容器裁切；支持 Escape、点击外部关闭、窄屏边距和明暗主题。设置页按账号分组，控件目标高度 32 px；本机登录发现与账号列表独立加载。
