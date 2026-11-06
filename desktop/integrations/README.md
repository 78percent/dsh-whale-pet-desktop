# 本机 Hooks 接入

`createHookManager({ dataDir, resourceDir, endpoint, token })` 只在设置页调用 `enable('codex'|'claude')` 或 `disable(...)` 时修改配置；`status()` 只读。Codex 的显式配置操作同时调用本目录 `codex.mjs`，完成当前桌宠钩子的正常授权。主进程负责维护 `dataDir/connection.json` 的 `{ endpoint, token }`，sender 每次事件读取它。令牌不写入 Hooks 命令，也不提供给渲染页面。

- Codex：`$CODEX_HOME/hooks.json`，未设置时使用 `~/.codex/hooks.json`；覆盖共享此配置的本机桌面会话与 CLI。用户点击“一键配置”代表允许写入和授权桌宠钩子。使用 Codex 自带 `hooks/list` 获取真实 key/hash，使用与桌面 Trust 按钮相同的 `config/batchWrite` 写入具体钩子的 `trusted_hash`。不会使用全局 trust bypass，也不启动模型任务。
- Claude Code：`$CLAUDE_CONFIG_DIR/settings.json`，未设置时使用 `~/.claude/settings.json`。命令采用官方 exec form，在 Windows 直接调用 PowerShell，无需 Git Bash。
- sender 复制到 `dataDir/integrations/send-event.ps1`，从便携程序临时目录移走后仍有稳定路径。`resourceDir` 必须包含本目录中的脚本。
- 配置仅合并/删除与自身记录完全匹配的 handler；保留其他设置、Hook、匹配组。原配置备份放在 `dataDir/hook-backups`。配置不是 JSON、结构异常或写入时检测到并发改动，均拒绝覆盖。
- 重配原位更新已有 handler，移除时保留中间空组，避免改变其他 Codex 钩子的信任索引。若用户手动把桌宠 handler 混排到同组其他 handler 前方，移除会拒绝写入并提示先分组；安装器自身不会生成这种结构。
- `enabled` 表示配置条目齐全；`ready` 表示配置步骤完成（Codex 包含授权回读）。`codex-setup.json` 记录上次配置结果及配置文件摘要，文件变化会使缓存失效。二者不证明新会话已经加载或事件已到达；活动列表的真实事件才是收到状态的依据。
- Codex 自动查找用户级桌面运行时、PATH/native 与 npm 原生程序，非标准安装允许文件选择。配置子进程有超时、隐藏窗口，只关闭本次创建的进程。授权只匹配当前脚本命令及当前 hooks.json 路径，不处理其他来源的钩子；写入前备份，使用预期配置版本防止并发覆盖。

`createActivityStore()` 返回 `ingest(event)`、`snapshot()`、`onChange(fn)` 和 `close()`。回调接收完整快照，退订函数由 `onChange` 返回。`status` 使用 `working`、`waiting`、`error`、`idle`、`unknown`、`ended`、`disconnected`；没有业务会话但桥接在线的 DSH 来源为 `connected`。

DSH 使用保留 ID `__dsh_bridge__` 发送 10–15 秒心跳，45 秒未到或该 ID 的 `session_end` 表示桥接断开。普通会话的 `snapshot` 缺少 `intent` 表示观察状态未知；`IDLE` 必须来自明确状态。Codex/Claude 两分钟没有状态更新时变为未知，保留活动工具记录。短暂错误动画结束后，`lastError` 时间继续保留。所有状态只存内存。

sender 不访问提示词、工具参数、转录文件或响应正文，只从 stdin JSON 中提取标识、Hook 类型、工具名称以及明确错误标志。每次本机 HTTP 请求超时 450 毫秒，失败无输出并退出 0。它从不返回批准、拒绝或继续执行等 Hook 决策。

会话开始、用户提交、子代理开始/结束、Stop/Interrupt/SessionEnd 使用短时同步发送，保留生命周期先后关系；工具及模型活动异步发送，并按工具标识处理乱序。生命周期 hook 的总超时为 2 秒，不更改权限决策。

已知边界：

- 官方 Hook 载荷未可靠区分 Codex 桌面与 CLI，来源统一显示 Codex，`client` 为 `unknown`；云端和远程主机不属于本机接收范围。
- Codex 子代理按 `agent_id` 归到子会话；Claude 按父 `session_id` 加 `agent_id` 隔离。若某版本不提供子代理身份，无法从工具名推断归属。
- 不读取转录文本或进程列表补猜状态；不支持事件或丢失结束事件时可能显示未知。其他 Stop Hooks 要求继续执行时，结束观察与下一轮恢复取决于工具提供的新生命周期标识。
- 没有运行测试、语法检查、模拟事件或模型任务。实际接入、配置加载和桌面联动需用户正常使用确认。

官方接口依据（2026-11-06 阅读）：

- https://developers.openai.com/codex/hooks/
- https://learn.chatgpt.com/docs/hooks
- https://code.claude.com/docs/en/hooks
