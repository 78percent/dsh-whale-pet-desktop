# 贡献指南

本仓库维护基于 luweiyabo/dsh-whale-pet 的 Windows 桌面适配。

## 提交问题

- Bug 请使用仓库的 Bug 模板，并提供 Windows、桌面版及相关 Codex / Claude Code / DSH 版本。
- 功能建议请说明使用场景、预期行为和可能的替代方案。
- 未修复的安全问题请按照 [SECURITY.md](./SECURITY.md) 私密报告。

## 本地开发

```sh
git clone https://github.com/78percent/dsh-whale-pet-desktop.git
cd dsh-whale-pet-desktop/desktop
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node node_modules/esbuild/install.js
npm run build
npm start
```

桌面版源码位于 `desktop/`，原网页插件源码保留在 `src/`。原项目说明见 README_UPSTREAM.md。

## 提交说明

请确保：

- 不提交 API Key、Token、私有配置、日志或本地虚拟环境。
- 如实说明构建结果和实际验证范围；未做的验证不要写成通过。
- 中文 README 与英文 README 中的产品信息保持一致。
- 新增媒体资源具有明确来源和可再分发授权，并同步更新第三方资源说明。

## Pull Request

保持每个 PR 聚焦于一个主题，在描述中写明变更原因、验证方式和界面变化。涉及视觉效果时请附截图或短视频。

---

English contributions are welcome. Keep pull requests focused, describe the motivation and actual verification performed, and privately report security issues through [SECURITY.md](./SECURITY.md).
