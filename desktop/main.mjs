import { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, protocol, dialog, shell, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, stat, cp, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createStorage } from './storage.mjs';
import { createReceiver } from './server.mjs';
import { createActivityStore } from './state.mjs';
import { createHookManager } from './integrations/hooks.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(app.getPath('appData'), 'WhalePetDesktop');
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'whalepet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();

let petWindow, settingsWindow, tray, storage, activity, hooks, receiver;
let actionList = [], connections = {}, hitRegions = [], selected = false, dragState = null, menuOpen = false;
let ignoreMouse = true, pollTimer, publishTimer, quitting = false;
const assets = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(root, '../assets');
const bridgeDir = app.isPackaged ? path.join(process.resourcesPath, 'dsh-bridge') : path.join(root, 'dsh-bridge');

const docs = {
  codex: 'https://learn.chatgpt.com/docs/hooks',
  claude: 'https://code.claude.com/docs/en/hooks',
  dsh: 'https://github.com/luweiyabo/dsh-whale-pet',
};
function currentDisplay() {
  return screen.getAllDisplays().find((d) => d.id === storage?.getConfig().displayId) || screen.getPrimaryDisplay();
}
function snapshot() {
  return {
    config: storage.getConfig(), activity: activity.snapshot(), connections,
    actions: actionList, version: app.getVersion(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `显示器 ${i + 1}`, primary: d.id === screen.getPrimaryDisplay().id })),
    displayId: currentDisplay().id,
  };
}
function publish() {
  if (!storage || !activity || quitting) return;
  const state = snapshot();
  for (const win of [petWindow, settingsWindow]) if (win && !win.isDestroyed()) win.webContents.send('desktop:snapshot', state);
  updateTray();
}
function schedulePublish() {
  if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = null; publish(); }, 100);
}
function command(data) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('desktop:command', data);
}
function nativeError(error) {
  dialog.showErrorBox('鲸鱼桌宠', String(error?.message || error));
}
function trusted(event) {
  return [petWindow, settingsWindow].some((win) => win && !win.isDestroyed() && win.webContents.id === event.sender.id)
    && event.senderFrame?.url.startsWith('whalepet://app/');
}
function handle(name, fn) {
  ipcMain.handle(`desktop:${name}`, (event, ...args) => {
    if (!trusted(event)) throw new Error('不允许的窗口');
    return fn(...args);
  });
}
function listen(name, fn) {
  ipcMain.on(`desktop:${name}`, (event, ...args) => {
    if (!trusted(event)) return;
    Promise.resolve().then(() => fn(...args)).catch(nativeError);
  });
}
function setIgnore(value) {
  if (ignoreMouse === value || !petWindow || petWindow.isDestroyed()) return;
  ignoreMouse = value;
  petWindow.setIgnoreMouseEvents(value, { forward: true });
}
function nativePointer() {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
  const onPet = hitRegions.some((r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height);
  setIgnore(!(onPet || selected || dragState || menuOpen));
}
async function setVisible(visible) {
  await storage.save({ pet: { visible } });
  if (visible) petWindow.showInactive();
  else { petWindow.hide(); hitRegions = []; selected = false; dragState = null; }
  publish();
}
async function home() { await setVisible(true); command({ type: 'home' }); }
async function setDisplay(id, cursor, offset = {}) {
  const display = screen.getAllDisplays().find((d) => d.id === id);
  if (!display) throw new Error('显示器已断开');
  await storage.save({ displayId: id });
  hitRegions = []; selected = false;
  petWindow.setBounds(display.workArea);
  if (cursor) {
    command({ type: 'position',
      x: Math.max(35, Math.min(display.workArea.width - 35, cursor.x - display.workArea.x - (offset.offsetX || 0))),
      y: Math.max(35, Math.min(display.workArea.height - 35, cursor.y - display.workArea.y - (offset.offsetY || 0))),
      width: display.workArea.width, height: display.workArea.height });
  } else command({ type: 'home' });
  publish();
}
function contextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '回家', click: () => home().catch(nativeError) },
    { label: '选择目的地', click: () => command({ type: 'target' }) },
    { label: '设置', click: showSettings },
    { label: '移到显示器', submenu: screen.getAllDisplays().map((d, i) => ({
      label: d.label || `显示器 ${i + 1}`, type: 'radio', checked: d.id === currentDisplay().id,
      click: () => setDisplay(d.id).catch(nativeError),
    })) },
    { type: 'separator' },
    { label: '隐藏', click: () => setVisible(false).catch(nativeError) },
    { label: '退出', click: () => app.quit() },
  ]);
  menuOpen = true; setIgnore(false);
  menu.popup({ window: petWindow, callback: () => { menuOpen = false; nativePointer(); } });
}
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const active = activity.snapshot();
  tray.setToolTip(active.sourceLabel ? `鲸鱼桌宠 · ${active.sourceLabel}` : '鲸鱼桌宠');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: storage.getConfig().pet.visible ? '隐藏桌宠' : '显示桌宠', click: () => setVisible(!storage.getConfig().pet.visible).catch(nativeError) },
    { label: '回家', click: () => home().catch(nativeError) },
    { label: '设置与连接', click: showSettings },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}
function protectWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('whalepet://app/')) event.preventDefault(); });
}
function showSettings() {
  if (!storage || quitting) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ width: 900, height: 750, minWidth: 740, minHeight: 580,
    title: '鲸鱼桌宠 · 设置', backgroundColor: '#f8fafc', autoHideMenuBar: true,
    icon: path.join(assets, 'plugin-logo.png'), show: false,
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  protectWindow(settingsWindow);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadURL('whalepet://app/settings.html').catch(nativeError);
}
function resolveInside(base, relative) {
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(path.resolve(base) + path.sep)) throw new Error('Invalid path');
  return target;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png' };
async function serveFile(request, file) {
  const info = await stat(file);
  if (!info.isFile()) return new Response(null, { status: 404 });
  let start = 0, end = info.size - 1, status = 200;
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (path.extname(file) === '.html') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'";
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file, { start, end })), { status, headers });
}
async function registerProtocol() {
  protocol.handle('whalepet', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/whale-pet/api/actions') return Response.json({ ok: true, actions: actionList });
      let file;
      if (pathname.startsWith('/whale-pet/custom/')) {
        const requested = pathname.slice('/whale-pet/custom/'.length);
        const action = actionList.find((item) => `${item.id}.${item.ext}` === requested);
        if (!action) return new Response(null, { status: 404 });
        file = resolveInside(storage.actionsDir, action.file);
      }
      else if (pathname.startsWith('/whale-pet/')) file = resolveInside(path.join(assets, 'thumb'), pathname.slice('/whale-pet/'.length));
      else if (pathname === '/assets/logo.png') file = path.join(assets, 'plugin-logo.png');
      else file = resolveInside(path.join(root, 'dist'), pathname.slice(1));
      return await serveFile(request, file);
    } catch { return new Response('File unavailable', { status: 404 }); }
  });
}

async function setup() {
  storage = await createStorage(dataDir);
  if (storage.firstRun) await storage.save({});
  actionList = await storage.actions();
  activity = createActivityStore();
  const token = randomBytes(32).toString('hex');
  receiver = await createReceiver({ token, onEvent: (event) => activity.ingest(event) });
  await writeFile(path.join(dataDir, 'connection.json'), JSON.stringify({ endpoint: receiver.endpoint, token }), 'utf8');
  hooks = createHookManager({ dataDir, resourceDir: path.join(root, 'integrations'), endpoint: receiver.endpoint, token });
  try { connections = await hooks.status(); }
  catch (error) { connections = { codex: { enabled: false, message: error.message }, claude: { enabled: false, message: error.message } }; }
  activity.onChange(schedulePublish);
  await registerProtocol();

  petWindow = new BrowserWindow({ ...currentDisplay().workArea, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  protectWindow(petWindow);
  petWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); setVisible(false).catch(nativeError); } });
  petWindow.once('ready-to-show', () => { if (storage.getConfig().pet.visible) petWindow.showInactive(); });

  handle('bootstrap', snapshot);
  handle('save-config', async (patch) => {
    const config = await storage.save(patch);
    if (config.pet.visible) petWindow.showInactive(); else petWindow.hide();
    publish(); return snapshot();
  });
  handle('connect', async (source) => {
    if (!['codex', 'claude'].includes(source)) throw new Error('未知来源');
    try { await hooks.enable(source); }
    finally { connections = await hooks.status(); publish(); }
    return snapshot();
  });
  handle('select-codex', async () => {
    const result = await dialog.showOpenDialog(settingsWindow, { title: '选择 Codex 安装中的 codex.exe',
      properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe'] }] });
    if (!result.canceled) {
      try { await hooks.enable('codex', { executable: result.filePaths[0] }); }
      finally { connections = await hooks.status(); publish(); }
    }
    return snapshot();
  });
  handle('disconnect', async (source) => {
    if (!['codex', 'claude'].includes(source)) throw new Error('未知来源');
    await hooks.disable(source); connections = await hooks.status(); publish(); return snapshot();
  });
  handle('import-actions', async () => {
    const result = await dialog.showOpenDialog(settingsWindow, { title: '导入透明动画', properties: ['openFile', 'multiSelections'], filters: [{ name: '动画', extensions: ['webm', 'mp4'] }] });
    if (!result.canceled) {
      try { await storage.importFiles(result.filePaths); }
      finally { actionList = await storage.actions(); publish(); }
    }
    return snapshot();
  });
  handle('remove-action', async (id) => {
    if (typeof id !== 'string' || !actionList.some((a) => a.id === id)) throw new Error('动作不存在');
    const result = await dialog.showMessageBox(settingsWindow, { type: 'question', message: `删除自定义动作“${id}”？`, buttons: ['取消', '删除'], defaultId: 0, cancelId: 0 });
    if (result.response === 1) { await storage.removeAction(id); actionList = await storage.actions(); publish(); }
    return snapshot();
  });
  handle('export-bridge', async () => {
    const result = await dialog.showOpenDialog(settingsWindow, { title: '选择桥接插件存放目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    let destination = path.join(result.filePaths[0], 'whale-pet-dsh-bridge');
    try { await access(destination); destination += `-${Date.now()}`; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await cp(bridgeDir, destination, { recursive: true, errorOnExist: true, force: false });
    const installCommand = `dsh plugin --profile web add "${destination}"`;
    clipboard.writeText(installCommand);
    return { path: destination, command: installCommand };
  });
  handle('open-docs', async (source) => { if (docs[source]) await shell.openExternal(docs[source]); });
  handle('set-display', async (id) => { await setDisplay(id); return snapshot(); });
  listen('show-settings', showSettings);
  listen('context-menu', contextMenu);
  listen('home', home);
  listen('hide', () => setVisible(false));
  listen('quit', () => app.quit());
  listen('preview', (id) => { if (typeof id === 'string' && id.length < 180) command({ type: 'preview', id }); });
  listen('reveal-data', () => shell.openPath(dataDir));
  listen('hit-regions', (data) => {
    if (!data || !Array.isArray(data.regions)) return;
    hitRegions = data.regions.slice(0, 8).filter((r) => r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])));
    const nextSelected = data.selected === true;
    if (nextSelected !== selected) {
      selected = nextSelected; petWindow.setFocusable(selected);
      if (selected) petWindow.focus();
    }
    nativePointer();
  });
  listen('drag', async (data) => {
    if (data?.active === true) {
      dragState = { offsetX: Number.isFinite(data.offsetX) ? data.offsetX : 0, offsetY: Number.isFinite(data.offsetY) ? data.offsetY : 0 };
    } else if (dragState) {
      const offset = dragState; dragState = null;
      const cursor = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursor);
      if (display.id !== currentDisplay().id) await setDisplay(display.id, cursor, offset);
    }
    nativePointer();
  });
  const trayImage = nativeImage.createFromPath(path.join(assets, 'plugin-logo.png')).resize({ width: 24, height: 24 });
  tray = new Tray(trayImage);
  tray.on('double-click', showSettings);
  updateTray();
  pollTimer = setInterval(nativePointer, 40);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => {
    if (!petWindow.isDestroyed()) { petWindow.setBounds(currentDisplay().workArea); command({ type: 'home' }); publish(); }
  });
  await petWindow.loadURL('whalepet://app/pet.html');
  if (storage.firstRun) showSettings();
}

app.on('second-instance', () => { if (storage) { home().catch(nativeError); showSettings(); } });
app.on('activate', showSettings);
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true; clearInterval(pollTimer); clearTimeout(publishTimer);
  receiver?.close(); activity?.close(); tray?.destroy();
});
if (lock) app.whenReady().then(setup).catch((error) => { nativeError(error); app.quit(); });
