# WhalePet Windows 桌宠

基于 [luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet) 的独立桌面适配，由 [78percent](https://github.com/78percent/dsh-whale-pet-desktop) 维护。原播放器、角色和动画来自上游，桌面版增加 Windows 窗口及多工具状态接入。

## 启动

从 [Releases](https://github.com/78percent/dsh-whale-pet-desktop/releases) 下载 `WhalePet-版本号.exe`，双击启动。首次显示设置；以后右键宠物或双击托盘图标打开设置。无需另装 Node.js 或 Python。

- 拖拽移动；跨显示器拖拽在松手时转移，也可从右键菜单选择显示器。
- 单击回应，双击特殊动作。空白区域穿透鼠标。
- 右键 → 选择目的地，再点击一次；Esc 取消。
- 托盘重新显示、回家和退出。“动作”页管理动作池、工作状态映射和自定义透明 WebM/MP4。
- 升级前从托盘退出旧版，再打开新版；设置与自定义动作会保留。

## Codex 桌面端与 CLI

设置 → 连接 → **Codex 桌面端 / CLI → 一键配置**。

程序自动寻找当前电脑上的 Codex，合并用户级 Hooks，备份配置，然后通过 Codex 自带接口授权本桌宠的具体钩子。点击配置即代表允许这一接入；不会关闭 Codex 全局信任检查，也不会启动模型任务或重启现有会话。

完成后显示“已配置并授权”。新开会话加载配置即可。首次没有找到安装位置时，点击 **选择 codex.exe…**，选择 Codex 安装中的原生程序；不选择桌宠 exe 或 npm 的 .cmd 文件。也可以更新 Codex 后再次点击“一键配置”。

支持常见桌面安装、PATH 中的原生 CLI 和 npm 安装。不需要为桌宠单独安装 Node.js。较旧的 Codex 只识别部分事件，界面会显示数量；只使用基础事件也能显示开始和结束。

桌面端与 CLI 共用同一用户配置时合并显示为 Codex；只监听本机执行的会话。如果终端单独设置了 `CODEX_HOME`，请从同一环境启动桌宠。全局 Hooks 开关或组织策略禁用时，需先在 Codex 中调整。移除接入只删除桌宠自己的钩子，历史信任记录不影响其他钩子的校验。

## Claude Code

设置 → 连接 → **Claude Code → 一键配置**。合并用户级 `.claude/settings.json`，保留其他设置并备份。新开 Claude Code 会话加载配置。

建议使用最新版本，至少 v2.1.295。若终端单独设置了 `CLAUDE_CONFIG_DIR`，请从同一环境启动桌宠。发送脚本使用 Windows 自带 PowerShell，不依赖 Git Bash；它不批准或拒绝工具调用，也不向模型注入内容。

## DeepSeek Harness

设置 → 连接 → **导出桥接插件**，选择目录。安装命令自动复制到剪贴板，在 DSH 终端执行，再按 DSH 提示重新加载插件。

```powershell
dsh plugin --profile web add "你的导出目录/whale-pet-dsh-bridge"
```

保持 DSH 服务和至少一个本机 localhost/回环地址的 Web 页面连接。关闭所有 DSH 页面后，该来源断开，其他来源继续工作。

## 状态与数据

等待处理和明确错误优先，其次显示最近活跃任务。一个任务结束不会清除其他正在工作的任务。“已配置”只代表配置就绪；收到真实事件后才显示工作状态。长时间无法确认的状态显示“未知”，不把超时当作完成。

数据位于 `%APPDATA%\WhalePetDesktop`；`hook-backups` 保存修改前的配置。只发送状态及会话/工具标识，不发送提示词、命令参数或回复正文，无额外模型调用。接收端仅监听本机回环地址。请勿分享 `connection.json` 或备份里的个人配置。

## 从源码构建

需要 Windows x64、Node.js 24 和 npm，在仓库的 `desktop/` 目录执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node node_modules/esbuild/install.js
npm run package
```

输出到仓库 `release/`。构建仅编译和打包，不运行测试。

## 边界与许可

预览版未运行自动化测试、模拟事件或端到端联动验收。支持普通桌面与应用窗口上方显示；独占全屏、锁屏和系统安全桌面不在覆盖范围。exe 未签名。

原项目和桌面适配源代码采用 MIT；多数动画有单独的非商用限制。包内保留原版权及第三方说明；详情见仓库 LICENSE、THIRD_PARTY_ASSETS.md 和 THIRD_PARTY_NOTICES.md。
