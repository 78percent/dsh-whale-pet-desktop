# Attribution and licenses

## Upstream application

WhalePet Desktop is a derivative of [luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet), originally developed by **luweiyabo** for the DeepSeek Harness web interface. The upstream source code is licensed under MIT. Its copyright notice and license are preserved in [LICENSE](LICENSE).

The desktop adaptation started from upstream commit `b61b445e6be05a732fc6738b825240aeffdf6769`. This repository retains the upstream Git history. The original player, character, animation catalog, and interaction logic come from that project; they are not newly authored by the desktop maintainer.

**78percent's adaptation** adds an Electron Windows desktop window, tray and display controls, local activity aggregation, Codex and Claude Code Hooks setup, a DSH companion bridge, and portable executable packaging. It is an independent derivative, not an official distribution from the upstream author, OpenAI, Anthropic, or DeepSeek.

Original documentation: [Chinese](README_UPSTREAM.md) · [English](README_UPSTREAM_EN.md).

## Animation media

Most animations in `assets/thumb/` originate from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). Their separate terms permit use in open-source projects and prohibit commercial use. Some animations were created by luweiyabo/dsh-whale-pet itself. The MIT source-code license does **not** relicense the upstream media.

The original scope and source links are preserved in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) and [THIRD_PARTY_ASSETS_EN.md](THIRD_PARTY_ASSETS_EN.md). Commercial use of the restricted media requires permission from its rights holders.

## Desktop runtime

The packaged application uses Electron (MIT, with Chromium and other third-party components), React (MIT), and the Node.js runtime distributed with Electron. The executable retains the runtime's bundled `LICENSE.electron.txt` and `LICENSES.chromium.html`; this notice does not replace their terms. Build dependencies and versions are recorded in `desktop/package-lock.json`.
