# WhalePet Desktop

- User-approved scope: a Windows portable exe reusing dsh-whale-pet, with DeepSeek Harness, Codex desktop local sessions, Codex CLI, and Claude Code activity monitoring.
- Work and outputs stay in this checkout; do not modify unrelated projects.
- User explicitly prohibits tests: do not write or run unit/integration/UI tests, simulated events, or model tasks. Compilation and packaging are allowed. Do not claim runtime acceptance from a build.
- Preserve original media and upstream licenses. The user authorized publishing this desktop derivative to the public 78percent/dsh-whale-pet-desktop repository.
- Preserve existing user Hooks when enabling integrations. Never bypass Codex hook trust or restart active tools.
- The user explicitly authorized one-click setup to grant trust only to the desktop pet's own hooks through Codex's normal config API. Never disable hook trust globally.
- Keep settings concise; avoid redundant labels and descriptions.
- Desktop application entrypoint: desktop/main.mjs; build/package commands are in desktop/package.json.
