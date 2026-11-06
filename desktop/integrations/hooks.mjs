import { readFile, writeFile, mkdir, copyFile, rename, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { configureCodex, readCodexSetup } from './codex.mjs';

const EVENTS = {
  codex: ['SessionStart', 'UserPromptSubmit', 'PreModelRequest', 'PostModelRequest', 'PreToolUse',
    'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'],
  claude: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'PermissionRequest', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd'],
};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const psLiteral = value => `'${value.replaceAll("'", "''")}'`;
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function parseConfig(raw, file) {
  let config;
  try { config = raw === null ? {} : JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`配置不是有效 JSON，未修改：${file}`); }
  if (!isObject(config) || (config.hooks !== undefined && !isObject(config.hooks))) {
    throw new Error(`Hooks 配置结构无法合并，未修改：${file}`);
  }
  for (const groups of Object.values(config.hooks || {})) {
    if (!Array.isArray(groups) || groups.some(group => !isObject(group) || !Array.isArray(group.hooks))) {
      throw new Error(`Hooks 条目结构无法合并，未修改：${file}`);
    }
  }
  return config;
}

/** Only explicit setup actions write settings or grant scoped hook trust. No model sessions are started. */
export function createHookManager({ dataDir, resourceDir, endpoint, token }) {
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(resourceDir)) throw new Error('Hooks 需要绝对资源路径');
  // The receiver owns connection.json. Credentials must never enter command lines or hook definitions.
  void endpoint;
  void token;
  const sender = path.join(dataDir, 'integrations', 'send-event.ps1');
  const connectionFile = path.join(dataDir, 'connection.json');
  const ownershipFile = path.join(dataDir, 'hook-ownership.json');
  const configPaths = {
    codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json'),
    claude: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json'),
  };
  let mutation = Promise.resolve();

  function definition(source, event) {
    // Lifecycle boundaries must arrive in order. Per-tool observation stays
    // asynchronous and uses tool IDs to tolerate begin/end delivery races.
    const async = !['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop',
      'Stop', 'Interrupt', 'SessionEnd'].includes(event);
    const commonArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', sender, '-Source', source, '-ConnectionFile', connectionFile];
    if (source === 'claude') {
      return { type: 'command', command: 'powershell.exe', args: commonArgs, timeout: 2, async, onFailure: 'continue' };
    }
    // EncodedCommand quotes a literal script path independently of the parent shell.
    // Its payload contains only local paths and a source name, never an endpoint token.
    const invocation = `& ${psLiteral(sender)} -Source ${psLiteral(source)} -ConnectionFile ${psLiteral(connectionFile)}`;
    const encoded = Buffer.from(invocation, 'utf16le').toString('base64');
    const command = `powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    return { type: 'command', command, commandWindows: command, timeout: 2, async };
  }

  async function ownership() {
    const raw = await readOptional(ownershipFile);
    if (raw === null) return {};
    try {
      const value = JSON.parse(raw);
      if (!isObject(value)) throw new Error();
      return value;
    } catch { throw new Error('桌宠 Hooks 所有权记录损坏，请保留现有配置后重新接入'); }
  }

  function owned(source, handler, registry) {
    const known = [definition(source), ...EVENTS[source].map(event => definition(source, event)),
      ...(Array.isArray(registry[source]) ? registry[source] : [])];
    return known.some(item => canonical(item) === canonical(handler));
  }

  async function sourceStatus(source, registry) {
    const configPath = configPaths[source];
    try {
      const config = parseConfig(await readOptional(configPath), configPath);
      const installed = EVENTS[source].filter(event => (config.hooks?.[event] || [])
        .some(group => group.hooks.some(handler => owned(source, handler, registry))));
      const enabled = installed.length === EVENTS[source].length;
      const disabled = config.disableAllHooks === true;
      const setup = source === 'codex' && enabled ? await readCodexSetup(dataDir, configPath) : { ready: enabled };
      const message = disabled ? '工具设置已禁用 Hooks' : enabled
        ? source === 'codex' ? setup.message : '已配置，新开 Claude Code 会话后生效。'
        : installed.length ? '接入项不完整，可重新连接' : '未接入';
      return { enabled, hasInstalledHooks: installed.length > 0, ready: enabled && !disabled && setup.ready, configPath,
        ...(source === 'codex' ? { needsTrust: enabled && !setup.ready,
          canChooseExecutable: setup.canChooseExecutable, supportedEvents: setup.supportedEvents } : {}), message };
    } catch (error) { return { enabled: false, configPath, message: error.message }; }
  }

  async function status() {
    let registry;
    try { registry = await ownership(); }
    catch (error) {
      return Object.fromEntries(Object.keys(EVENTS).map(source => [source,
        { enabled: false, configPath: configPaths[source], message: error.message }]));
    }
    const rows = await Promise.all(Object.keys(EVENTS).map(async source => [source, await sourceStatus(source, registry)]));
    return Object.fromEntries(rows);
  }

  async function atomicWrite(file, raw, expected) {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.whalepet-${randomUUID()}.tmp`;
    try {
      await writeFile(temp, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (expected !== undefined && await readOptional(file) !== expected) {
        throw new Error('配置在接入时发生变化，已停止写入；请重新连接');
      }
      await rename(temp, file);
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  async function change(source, enable, options = {}) {
    if (!Object.hasOwn(EVENTS, source)) throw new Error('不支持的 Hooks 来源');
    let configPath = configPaths[source];
    try { configPath = await realpath(configPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const before = await readOptional(configPath);
    const config = parseConfig(before, configPath);
    const registry = await ownership();
    let changed = false;
    const hooks = config.hooks || {};
    const finishSetup = async () => {
      if (enable && source === 'codex' && config.disableAllHooks !== true) {
        await configureCodex({ dataDir, hooksPath: configPaths.codex, executable: options.executable,
          commands: new Set(EVENTS.codex.map(event => definition('codex', event).commandWindows)) });
      }
      return sourceStatus(source, registry);
    };
    if (enable && EVENTS[source].every(event => (hooks[event] || []).some(group =>
      group.hooks.some(handler => canonical(handler) === canonical(definition(source, event)))))) {
      // Reconfiguring must not reorder hook groups: Codex trust keys include their indexes.
      await mkdir(path.dirname(sender), { recursive: true });
      await copyFile(path.join(resourceDir, 'send-event.ps1'), sender);
      return finishSetup();
    }
    if (!enable) for (const [event, groups] of Object.entries(hooks)) {
      hooks[event] = groups.map(group => {
        const ours = group.hooks.map(handler => owned(source, handler, registry));
        if (!ours.some(Boolean)) return group;
        // Our installer uses separate groups. If a user manually mixed handlers,
        // removing a non-trailing one would invalidate somebody else's trust key.
        const lastOther = ours.lastIndexOf(false);
        if (source === 'codex' && ours.some((isOurs, index) => isOurs && index < lastOther)) {
          throw new Error('桌宠与其他 Codex 钩子被混排在同一组，请先在 hooks.json 中分组后移除；现有配置未改动。');
        }
        changed = true;
        return { ...group, hooks: group.hooks.filter((_, index) => !ours[index]) };
      });
      // Empty groups in the middle are valid and preserve later groups' indexes.
      while (hooks[event].length && !hooks[event].at(-1).hooks.length) hooks[event].pop();
      if (!hooks[event].length && groups.length) delete hooks[event];
    }
    if (enable) {
      await mkdir(path.dirname(sender), { recursive: true });
      await copyFile(path.join(resourceDir, 'send-event.ps1'), sender);
      const installedHandlers = [];
      for (const event of EVENTS[source]) {
        const handler = definition(source, event);
        installedHandlers.push(handler);
        let replaced = false;
        for (const group of hooks[event] || []) {
          group.hooks = group.hooks.map(existing => {
            if (!owned(source, existing, registry)) return existing;
            replaced = true;
            return { ...handler };
          });
        }
        if (!replaced) {
          const group = { hooks: [{ ...handler }] };
          if (source === 'claude' && event === 'Notification') {
            group.matcher = 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|quota_auto_resume_stale';
          }
          (hooks[event] ||= []).push(group);
        }
      }
      registry[source] = [...(Array.isArray(registry[source]) ? registry[source] : []), ...installedHandlers]
        .filter((item, index, list) => list.findIndex(candidate => canonical(candidate) === canonical(item)) === index);
      // Record exact owned handlers first, so an interrupted install is still removable.
      await atomicWrite(ownershipFile, `${JSON.stringify(registry, null, 2)}\n`);
      changed = true;
    }
    if (!changed) return sourceStatus(source, registry);
    if (Object.keys(hooks).length || config.hooks !== undefined) config.hooks = hooks;
    const indent = before?.match(/\n([\t ]+)"/)?.[1] || '  ';
    const newline = before?.includes('\r\n') ? '\r\n' : '\n';
    const after = `${JSON.stringify(config, null, indent)}\n`.replaceAll('\n', newline);
    if (before !== null) {
      const backupDir = path.join(dataDir, 'hook-backups');
      await mkdir(backupDir, { recursive: true });
      await writeFile(path.join(backupDir, `${source}-${Date.now()}-${randomUUID()}.json`), before,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    await atomicWrite(configPath, after, before);
    return finishSetup();
  }

  function enqueue(source, enable, options) {
    const next = mutation.then(() => change(source, enable, options));
    mutation = next.catch(() => {});
    return next;
  }
  return { status, enable: (source, options) => enqueue(source, true, options), disable: source => enqueue(source, false) };
}
