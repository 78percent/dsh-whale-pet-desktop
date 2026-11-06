import { mkdir, readFile, writeFile, rename, readdir, stat, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function createStorage(dataDir) {
  const actionsDir = path.join(dataDir, 'actions');
  const configPath = path.join(dataDir, 'settings.json');
  await mkdir(actionsDir, { recursive: true });
  let config = { pet: { visible: true, size: 462, bubbles: true, fx: true, meter: false, scope: 'any' }, displayId: null };
  let firstRun = false;
  try {
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid settings file');
    config = { ...config, ...saved, pet: { ...config.pet, ...saved.pet, meter: false, scope: 'any' } };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取设置，原文件已保留：${configPath}\n${error.message}`);
    firstRun = true;
  }
  let writeQueue = Promise.resolve();
  function save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('无效设置');
    const next = { ...config, pet: { ...config.pet } };
    if ('displayId' in patch) {
      if (patch.displayId !== null && !Number.isInteger(patch.displayId)) throw new Error('无效显示器');
      next.displayId = patch.displayId;
    }
    if (patch.pet) {
      const p = patch.pet;
      for (const k of ['visible', 'fx', 'bubbles']) if (typeof p[k] === 'boolean') next.pet[k] = p[k];
      if (Number.isFinite(p.size)) next.pet.size = Math.min(800, Math.max(200, Math.round(p.size)));
      if (['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(p.position)) next.pet.position = p.position;
      if (p.behavior && typeof p.behavior === 'object') {
        next.pet.behavior = { ...next.pet.behavior };
        for (const [k, v] of Object.entries(p.behavior)) if (Number.isFinite(v) && v >= 0 && v <= 60000)
          next.pet.behavior[k] = v;
      }
      for (const group of ['pools', 'intents']) if (p[group] && typeof p[group] === 'object') {
        next.pet[group] = { ...next.pet[group] };
        for (const [k, v] of Object.entries(p[group])) if (Array.isArray(v))
          next.pet[group][k] = [...new Set(v.filter((id) => typeof id === 'string' && id.length <= 180))].slice(0, 250);
      }
    }
    config = next;
    const text = JSON.stringify(next, null, 2);
    const pending = writeQueue.then(async () => {
      const temp = `${configPath}.${randomUUID()}.tmp`;
      await writeFile(temp, text, 'utf8');
      await rename(temp, configPath);
    });
    writeQueue = pending.catch(() => {});
    return pending.then(() => config);
  }
  async function actions() {
    const list = [];
    for (const item of await readdir(actionsDir, { withFileTypes: true })) {
      if (!item.isFile() || !/\.(webm|mp4)$/i.test(item.name)) continue;
      const info = await stat(path.join(actionsDir, item.name));
      const ext = path.extname(item.name).slice(1).toLowerCase();
      list.push({ id: `custom:${item.name.slice(0, -(ext.length + 1))}`, file: item.name, ext, mtime: info.mtimeMs, size: info.size });
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function importFiles(files) {
    let bytes = (await actions()).reduce((sum, a) => sum + a.size, 0);
    const added = [];
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const info = await stat(file);
      if (!['.webm', '.mp4'].includes(ext) || !info.isFile()) throw new Error('仅支持 WebM / MP4 文件');
      if (info.size > 64 * 1024 * 1024) throw new Error('每个动作文件最大 64 MB');
      if (bytes + info.size > 512 * 1024 * 1024) throw new Error('自定义动作总容量最多 512 MB');
      const name = path.basename(file, path.extname(file)).slice(0, 130);
      let dest = path.join(actionsDir, `${name}${ext}`);
      try { await copyFile(file, dest, 1); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        dest = path.join(actionsDir, `${name}-${randomUUID().slice(0, 6)}${ext}`);
        await copyFile(file, dest, 1);
      }
      bytes += info.size; added.push(path.basename(dest));
    }
    return added;
  }
  async function removeAction(id) {
    const action = (await actions()).find((a) => a.id === id);
    if (!action) throw new Error('动作不存在');
    await unlink(path.join(actionsDir, action.file));
    const patch = {};
    for (const group of ['pools', 'intents']) {
      patch[group] = {};
      for (const [key, ids] of Object.entries(config.pet[group] || {}))
        if (Array.isArray(ids)) patch[group][key] = ids.filter((entry) => entry !== id);
    }
    await save({ pet: patch });
  }
  return { getConfig: () => config, save, firstRun, actions, importFiles, removeAction, actionsDir, dataDir };
}
