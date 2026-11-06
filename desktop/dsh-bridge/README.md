# WhalePet Desktop · DSH 桥接

配套插件把已连接 DSH Web 页面的会话活动发送给本机桌宠。沿用上游 `dsh-whale-pet` 的 `host-api.js` 和 `activity.js`，覆盖其支持的 DSH 0.1.x 与 0.2.0-rc.2 API。这个包不绘制网页桌宠，也不携带动画资源，可与原网页插件共存。

## 安装与移除

先启动 `WhalePet.exe`，再在已有 DSH 安装的终端执行（把路径替换为实际随交付的插件目录）：

```powershell
dsh plugin --profile web add "D:\WhalePet\dsh-bridge"
```

此命令沿用上游的本地目录安装方式；需要已有 DSH 和其插件管理所用的 pnpm。不要把整个桌宠源码根目录作为此插件安装。安装目录需包含构建后的 `lib/client.js`。源码版须先完成桌宠项目构建。

在没有正在执行的工作时，按 DSH 原有方式重新启动 Web profile，并重新打开页面。保持至少一个页面连接。页面使用 `http://localhost:<DSH端口>` 或 `http://127.0.0.1:<DSH端口>`；DSH 主机须与桌宠位于同一 Windows 用户的本机环境。不要为这个插件暴露桌宠端口。

移除：

```powershell
dsh plugin --profile web remove @whale-pet/desktop-bridge
```

随后在方便时重启该 DSH profile。移除不删除桌宠数据，也不修改其他插件。本文命令是供用户选择执行的安装操作；开发过程中没有安装 DSH 或改动真实 profile。

## 数据与连接

页面经同源 `POST /whale-pet-desktop/api/bridge` 发送归一化会话快照。主机读取 `%APPDATA%\WhalePetDesktop\connection.json` 的 `{endpoint,token}`，向其中的本机 `POST /events` 发送 `Authorization: Bearer <token>`。自定义位置使用 DSH 主机环境变量 `WHALE_PET_CONNECTION_FILE`。连接文件只在主机读取，不下发到网页。

出站字段仅包含 `source`、`client`、`sessionId`、`eventId`、`kind`、`intent`、`at`。每个会话发送当前权威 `snapshot`；明确完成或中断为 `IDLE`，并发工具先由上游分类器合并。不会把同一会话拆成互相遗留的桌宠轮次。不发送用户消息、工具参数或命令、回复内容、模型凭据。主机再次按允许字段重建出站对象。

页面每 10 秒续约；主机最多保留一个活动页面，其他页面等待接替，避免同一事件重复计入。主页面租约 30 秒失效，主机每 5 秒清理；正常关闭会尽力立即通知。全部页面失联后发送保留会话 `__dsh_bridge__` 的 `session_end`，桌宠把来源显示为断开。页面仍存在但会话流重建时，`snapshot` 不含 `intent` 表示该会话状态未知；不会误报已完成。

桌宠关闭时请求以短超时退出，不影响 DSH 审批、消息或模型执行。重开桌宠后，下一次页面续约发送当前快照，不回放旧任务。后台标签页被浏览器休眠时可能暂时断开，恢复连接后会重新获取当前状态。

## 构建接入

仓库入口：`desktop/dsh-bridge/src/client.js`。根桌宠构建脚本使用 esbuild 的 `bundle: true`、`format: 'iife'`、`platform: 'browser'`、`target: 'es2022'` 编译为本包 `lib/client.js`。host 入口 `lib/index.js` 使用 Node 内置模块，无额外运行时依赖。

发布目录至少保留 `package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`LICENSE`、`README.md`。包未发布到 npm；安装使用随交付的本地目录。源代码的 MIT 许可保留了上游作者声明。

按用户要求未编写或运行测试、模拟事件、语法检查或真实模型调用。构建只说明产物已生成；实际 DSH 安装、连接与桌面联动须由用户使用确认。
