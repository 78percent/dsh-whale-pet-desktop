# WhalePet Desktop · 鲸鱼桌宠 Windows 版

<img src="assets/plugin-logo.png" width="150" alt="WhalePet 鲸鱼桌宠">

让鲸鱼娘从 DSH 网页走到 Windows 桌面，陪伴 Codex、Claude Code 和 DeepSeek Harness 工作。

[下载 Windows 便携版](https://github.com/78percent/dsh-whale-pet-desktop/releases) · [使用说明](desktop/README.md) · [English](README_EN.md)

> **本项目基于 [luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet) 二次开发。** 原角色、播放器、动画目录和主要互动逻辑来自上游。本仓库由 **78percent** 增加 Windows 桌面适配和多工具状态接入，不是上游官方版本。

## 下载与开始使用

1. 打开 [Releases](https://github.com/78percent/dsh-whale-pet-desktop/releases)，下载最新的 `WhalePet-版本号.exe`。
2. 双击启动；首次自动打开设置。无需安装 Node.js、Python 或 DSH 即可使用桌宠。
3. 在 **设置 → 连接** 中，对需要监听的 Codex 或 Claude Code 点击 **一键配置**。
4. 新开对应工具的本机会话，保持桌宠运行。收到真实活动后，桌宠会切换工作动作。

升级时先从托盘退出旧版，再打开新版 exe；设置和自定义动作沿用当前用户的数据目录。当前发布为 Windows x64 预览版，未进行自动化测试或端到端运行验收。程序未签名。

## 桌面版增加了什么

- **独立桌面窗口**：透明、置顶、空白区域鼠标穿透，脱离浏览器使用。
- **桌面互动**：拖拽、点击、漫游、跨显示器移动、托盘找回与退出。
- **多来源状态**：同时接收 Codex、Claude Code、DSH 的事件；按会话记录，避免一个任务结束覆盖其他任务。
- **一键配置**：按当前用户生成接入脚本，备份并合并 Hooks，保留已有设置。
- **Codex 授权**：通过 Codex 自带配置接口，只信任本桌宠的具体钩子；无需再找审核按钮，不关闭全局信任机制。
- **动作管理**：复用上游 95 个透明动画，支持动作池、状态映射和自定义 WebM / MP4。

<img src="docs/images/actions/idle/breathing.gif" width="240" alt="上游鲸鱼待机动画">

上图为上游动画资源预览。完整的上游功能与动画目录见 [原始 README](README_UPSTREAM.md)。

## 接入支持

| 工具 | 配置方式 | 说明 |
| --- | --- | --- |
| Codex 桌面端 | 一键配置 | 本机执行的会话；与 CLI 共用用户级配置 |
| Codex CLI | 一键配置 | 自动查找原生程序或 npm 安装；事件种类由安装版本决定 |
| Claude Code | 一键配置 | 使用官方 Hooks；建议更新到最新版，至少 v2.1.295 |
| DeepSeek Harness | 导出桥接插件后安装 | 需运行 DSH 服务，并保留至少一个已连接的本地网页 |

只安装 Codex 桌面端也可自动发现常见安装位置。非标准安装或发现失败时，点击 **选择 codex.exe…**。较旧的 Codex CLI 可能只提供开始、结束、子代理等基础事件，设置中会显示实际支持数量。

如果你为终端单独设置了 `CODEX_HOME` 或 `CLAUDE_CONFIG_DIR`，请从同一环境启动桌宠；不同配置目录不会自动合并。已有的全局 Hooks 禁用或组织管理策略需要在对应工具中处理。

## 配置与数据

- 数据目录：`%APPDATA%\WhalePetDesktop`。
- Codex 配置：`%USERPROFILE%\.codex\hooks.json` 和对应 `config.toml` 中的桌宠授权记录；支持 `CODEX_HOME`。
- Claude Code 配置：`%USERPROFILE%\.claude\settings.json`；支持 `CLAUDE_CONFIG_DIR`。
- 修改前的配置保存在 `hook-backups`，移除接入只删除本桌宠的钩子。
- 接收服务仅监听 `127.0.0.1`，带有本机配对令牌。仅传递状态及会话/工具标识，不传递提示词、命令参数或回复正文，不额外调用模型。

“已配置”表示接入配置就绪；“已收到事件”才表示实际收到了工作状态。不要上传个人数据目录、连接令牌或配置备份。

## 从源码构建

需要 Windows x64、Node.js 24 和 npm：

```powershell
git clone https://github.com/78percent/dsh-whale-pet-desktop.git
cd dsh-whale-pet-desktop/desktop
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node node_modules/esbuild/install.js
npm run package
```

输出位于仓库根目录的 `release/`。日常开发使用 `npm run build` 后运行 `npm start`。打包命令只编译和打包；本仓库未启用自动测试工作流。

桌面源码位于 `desktop/`；`src/client/index.js` 保留上游播放器并增加少量桌面适配接口。根目录原 npm 配置属于上游 DSH 插件，构建桌面版请进入 `desktop/`。

## 使用边界

支持普通桌面与应用窗口上方显示，不覆盖独占全屏、锁屏或系统安全桌面。远程/云端 Codex 任务不在本机监听范围。DSH 网页全部关闭后，其状态来源会断开。静默、缺失或不支持的事件可能显示“状态未知”，不根据超时猜测任务成功。

## 致谢与许可

- **直接上游：[luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet)**，作者 luweiyabo。本项目保留原 Git 历史，从提交 `b61b445` 开始增加桌面适配。
- **动画来源：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**，提供大部分动画资源；部分动画由直接上游制作。
- **本仓库改动：78percent**，Windows 桌面宿主、托盘与多屏、状态聚合、Codex/Claude Hooks 接入、DSH 桥接及 exe 打包。

源代码使用 [MIT License](LICENSE)，保留原作者版权声明。**多数动画另有禁止商业使用条款，不能将整个素材包视为 MIT 授权。** 详情见 [第三方资源许可](THIRD_PARTY_ASSETS.md) 和 [完整署名说明](THIRD_PARTY_NOTICES.md)。商业使用相关动画前请向权利人取得授权。
