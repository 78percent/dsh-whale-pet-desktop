# WhalePet Desktop for Windows

A standalone transparent desktop companion for local Codex desktop/CLI, Claude Code, and DeepSeek Harness sessions.

**This is a derivative of [luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet), not the upstream author's official Windows release.** The character, animation catalog, player, and interaction logic come from upstream. **78percent** added the Electron desktop host, tray/display controls, local activity aggregation, integration setup, and portable Windows packaging.

[中文](README.md) · [Download](https://github.com/78percent/dsh-whale-pet-desktop/releases) · [Original upstream README](README_UPSTREAM_EN.md)

## Quick start

1. Download `WhalePet-<version>.exe` from Releases and open it. No separate Node.js or Python installation is required.
2. Open Settings → Connections and click **一键配置** (Configure) for Codex or Claude Code.
3. Open a new local agent session and keep the pet running.

Codex setup discovers the local executable, merges this pet's hooks, and grants trust to those exact hooks through Codex's normal configuration API. It never disables global hook trust. A file picker is available for nonstandard Codex installations. Existing settings are preserved and backed up. Older Codex versions expose fewer events. Use Claude Code v2.1.295 or newer.

DSH requires the exported companion plugin and at least one connected localhost web page. Remote/cloud sessions are outside the local integration scope. The settings UI is currently Chinese.

Settings, custom animations, connection metadata, and hook backups live in `%APPDATA%\WhalePetDesktop`. Custom `CODEX_HOME` / `CLAUDE_CONFIG_DIR` values must be inherited by the pet when launched. Close the old pet through its tray menu before running a newer executable.

This Windows x64 preview is unsigned. Packaging and read-only review do not establish real interaction or integration acceptance; automated and end-to-end tests have not been run.

## Build

On Windows x64 with Node.js 24:

```powershell
git clone https://github.com/78percent/dsh-whale-pet-desktop.git
cd dsh-whale-pet-desktop/desktop
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node node_modules/esbuild/install.js
npm run package
```

The executable is written to `release/` at the repository root. Packaging only compiles and builds; this repository has no automatic test workflow.

## Credits and licenses

Upstream application: **luweiyabo**, [luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet), based on commit `b61b445`, with upstream Git history preserved.

Most animation media: [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet), with some additional animations authored by the direct upstream project.

Source code is MIT licensed, with upstream copyright notices retained. **Most animation media have separate noncommercial terms and are not relicensed under MIT.** See [LICENSE](LICENSE), [THIRD_PARTY_ASSETS_EN.md](THIRD_PARTY_ASSETS_EN.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
