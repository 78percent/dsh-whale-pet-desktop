import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { readFile, writeFile, copyFile, mkdir, readdir, stat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
async function optional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}
async function directories(folder) {
  try { return (await readdir(folder, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => path.join(folder, e.name)); }
  catch { return []; }
}
async function fingerprint(hooksPath) {
  const hash = createHash('sha256');
  for (const file of [hooksPath, path.join(path.dirname(hooksPath), 'config.toml')]) {
    hash.update(await optional(file)); hash.update('\0');
  }
  return hash.digest('hex');
}

export async function readCodexSetup(dataDir, hooksPath) {
  try {
    const saved = JSON.parse(await optional(path.join(dataDir, 'codex-setup.json')));
    if (saved.fingerprint === await fingerprint(hooksPath)) return saved;
  } catch { /* Missing or stale summary means setup must be refreshed explicitly. */ }
  return { ready: false, needsTrust: true, message: '点击一键配置，完成桌宠 Hooks 授权。' };
}

async function discoverCodex(preferred) {
  if (preferred) return await isFile(preferred) ? [preferred] : [];
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const binaries = [];
    for (const dir of await directories(path.join(local, 'OpenAI/Codex/bin'))) {
      const file = path.join(dir, 'codex.exe');
      if (await isFile(file)) binaries.push({ file, modified: (await stat(file)).mtimeMs });
    }
    binaries.sort((a, b) => b.modified - a.modified);
    if (binaries.length) candidates.push(binaries[0].file);
    for (const folder of ['Programs/Codex/resources', 'Codex/resources']) {
      candidates.push(path.join(local, folder, 'codex.exe'));
    }
  }
  // Inspect PATH directly: npm's .cmd/.ps1 shims cannot be spawned without a shell.
  // Find their native package executable instead, preserving non-ASCII/spaced paths.
  const searchDirs = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  searchDirs.add(path.join(os.homedir(), '.local/bin'));
  if (process.env.APPDATA) searchDirs.add(path.join(process.env.APPDATA, 'npm'));
  for (const folder of searchDirs) {
    candidates.push(path.join(folder, 'codex.exe'));
    const packageDir = path.join(folder, 'node_modules/@openai/codex');
    const vendors = [path.join(packageDir, 'vendor')];
    for (const arch of ['x64', 'arm64']) {
      vendors.push(path.join(packageDir, `node_modules/@openai/codex-win32-${arch}/vendor`));
      vendors.push(path.join(folder, `node_modules/@openai/codex-win32-${arch}/vendor`));
    }
    for (const vendor of vendors) for (const triple of await directories(vendor)) {
      candidates.push(path.join(triple, 'bin/codex.exe'), path.join(triple, 'codex/codex.exe'));
    }
  }
  const found = [];
  for (const candidate of candidates) {
    if (!found.some(file => samePath(file, candidate)) && await isFile(candidate)) found.push(candidate);
  }
  if (found.length) return found;
  // Older Microsoft Store builds keep the runtime inside their installed package.
  try {
    const command = 'Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty InstallLocation';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 8000 });
    for (const folder of stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const file = path.join(folder, 'app/resources/codex.exe');
      if (await isFile(file)) found.push(file);
    }
  } catch { /* File selection remains available for nonstandard installations. */ }
  return found;
}

async function withCodex(executable, cwd, operation) {
  const child = spawn(executable, ['app-server', '--stdio'], {
    cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 0, failure;
  const pending = new Map();
  const fail = error => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const timer = setTimeout(() => { fail(new Error('Codex 配置接口响应超时，请关闭设置后重试。')); child.kill(); }, 25000);
  child.on('error', () => fail(new Error('无法启动所选 Codex 的配置接口。')));
  child.on('exit', () => fail(new Error('Codex 配置接口已退出，请更新 Codex 或选择其他安装。')));
  child.stdin.on('error', () => fail(new Error('Codex 配置连接已关闭。')));
  // Do not expose model provider configuration, tokens, or startup logs to the UI.
  child.stderr.on('data', () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`Codex 无法完成 ${request.method}，请更新 Codex 后重试。`));
    else request.resolve(message.result);
  });
  function rpc(method, params) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  try {
    await rpc('initialize', { clientInfo: { name: 'whalepet_setup', version: '0.1.1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
    return await operation(rpc);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    // Only this short-lived configuration process is closed; active Codex sessions are untouched.
    if (child.exitCode === null) await new Promise(resolve => {
      const closeTimer = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(closeTimer); resolve(); });
    });
  }
}

/** Called only by the user's explicit Configure action. Never uses a trust-bypass flag. */
export async function configureCodex({ dataDir, hooksPath, commands, executable }) {
  const savedPath = path.join(dataDir, 'codex-setup.json');
  let previous = {};
  try { previous = JSON.parse(await optional(savedPath)); } catch { /* first setup */ }
  if (executable && (!path.isAbsolute(executable) || path.basename(executable).toLowerCase() !== 'codex.exe')) {
    throw new Error('请选择 Codex 安装中的 codex.exe。');
  }
  // Rediscover after desktop updates; cached binaries often remain on disk.
  const candidates = await discoverCodex(executable);
  if (!executable && previous.executable && await isFile(previous.executable)
    && !candidates.some(file => samePath(file, previous.executable))) candidates.push(previous.executable);
  let outcome = { ready: false, needsTrust: true, canChooseExecutable: true,
    message: '钩子已写入。未找到 Codex，请选择 codex.exe 完成授权。' };
  const actualHooksPath = await realpath(hooksPath);
  const configPath = path.join(path.dirname(hooksPath), 'config.toml');
  for (const candidate of candidates.slice(0, 3)) {
    try {
      outcome = await withCodex(candidate, dataDir, async rpc => {
        const inspect = async () => {
          const result = await rpc('hooks/list', { cwds: [dataDir] });
          const entry = result?.data?.[0];
          if (!entry || entry.errors?.some(error => samePath(error.path, actualHooksPath))) {
            throw new Error('Codex 未能读取桌宠钩子，请检查 Hooks 配置。');
          }
          return entry.hooks.filter(hook => samePath(hook.sourcePath, actualHooksPath)
            && hook.handlerType === 'command' && commands.has(hook.command));
        };
        const hooks = await inspect();
        if (!hooks.length) throw new Error('当前 Codex 未识别桌宠 Hooks，请更新 Codex 并确认未禁用 Hooks。');
        const config = await rpc('config/read', { includeLayers: true, cwd: dataDir });
        const canonicalConfig = await realpath(configPath).catch(error => { if (error.code === 'ENOENT') return configPath; throw error; });
        const userLayer = config.layers?.find(layer => layer.name.type === 'user' && samePath(layer.name.file, canonicalConfig));
        const edits = hooks.flatMap(hook => {
          const prefix = `hooks.state.${JSON.stringify(hook.key)}`;
          const values = [];
          if (hook.trustStatus !== 'trusted' && hook.trustStatus !== 'managed') {
            values.push({ keyPath: `${prefix}.trusted_hash`, value: hook.currentHash, mergeStrategy: 'upsert' });
          }
          if (!hook.enabled && !hook.isManaged) values.push({ keyPath: `${prefix}.enabled`, value: true, mergeStrategy: 'upsert' });
          return values;
        });
        if (edits.length) {
          const backupDir = path.join(dataDir, 'hook-backups');
          await mkdir(backupDir, { recursive: true });
          if (await isFile(canonicalConfig)) {
            if (!userLayer?.version) throw new Error('无法确认 Codex 用户配置版本，已保留现有设置。');
            await copyFile(canonicalConfig, path.join(backupDir, `codex-trust-${Date.now()}-${randomUUID()}.toml`));
          }
          const result = await rpc('config/batchWrite', { edits, filePath: canonicalConfig,
            expectedVersion: userLayer?.version ?? null, reloadUserConfig: true });
          if (result.status !== 'ok') throw new Error('Codex 的管理策略覆盖了桌宠授权，请在 Codex 中查看 Hooks 设置。');
        }
        const after = await inspect();
        const ready = after.length === hooks.length && after.every(hook => hook.enabled && ['trusted', 'managed'].includes(hook.trustStatus));
        return { executable: candidate, ready, needsTrust: !ready, canChooseExecutable: !ready,
          supportedEvents: after.map(hook => hook.eventName),
          message: ready ? after.length < 12
            ? `已配置并授权。当前 Codex 支持 ${after.length} 类基础事件；更新 Codex 可获得更多状态。`
            : '已配置并授权，新开 Codex 会话后生效。'
            : '钩子已写入，Codex 尚未启用全部接入项，请检查全局 Hooks 开关。' };
      });
      break;
    } catch (error) {
      outcome = { executable: candidate, ready: false, needsTrust: true, canChooseExecutable: true,
        message: `钩子已写入，授权未完成：${error.message}` };
    }
  }
  outcome.fingerprint = await fingerprint(hooksPath);
  await writeFile(savedPath, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  return outcome;
}
