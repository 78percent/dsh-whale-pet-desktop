import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { runtime, React, intentLabels, sourceLabels } from './host.jsx';

const initial = await window.desktop.bootstrap();
const categories = { idle: '待机', turn: '转身', clicks: '点击', drag: '拖拽', moves: '移动', daily: '日常', work: '工作', festivals: '节日', food: '美食', fun: '趣味', games: '游戏', music: '音乐', magic: '魔术', memes: '梗图', special: '鲸鱼', weather: '天气', custom: '自定义' };
const mappings = { working: '处理中', coding: '写代码 / 执行工具', reading: '阅读', researching: '检索', thinking: '处理请求', waitingUser: '等待操作', listening: '收到任务', error: '错误' };
const statusLabels = { connected: '已收到事件', online: '已收到事件', active: '工作中', working: '工作中', idle: '空闲', waiting: '等待你处理', error: '发生错误', disconnected: '已断开', offline: '未连接', unknown: '状态未知', ended: '已结束', stopped: '已结束', interrupted: '已中断' };

function App() {
  const [state, setState] = useState(initial);
  const [tab, setTab] = useState('appearance');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [pool, setPool] = useState('acts');
  const [preview, setPreview] = useState('breathing');
  const [sizeDraft, setSizeDraft] = useState(initial.config.pet.size || 462);
  const sizeEditing = useRef(false);
  useEffect(() => window.desktop.onSnapshot(setState), []);
  useEffect(() => { if (!sizeEditing.current) setSizeDraft(state.config.pet.size || 462); }, [state.config.pet.size]);
  const config = runtime.mergeConfig(state.config.pet);
  runtime.setCustomAnims(state.actions);
  const actions = [...runtime.ANIMS, ...state.actions.map((a) => ({ ...a, nameZh: a.id.replace(/^custom:/, ''), category: 'custom' }))];
  const selectedAction = actions.find((a) => a.id === preview) || actions[0];
  const filtered = actions.filter((a) => (category === 'all' || a.category === category)
    && `${a.id} ${a.nameZh} ${a.name}`.toLowerCase().includes(search.toLowerCase()));
  async function run(key, fn) {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { return await fn(); } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(''); }
  }
  const save = (pet) => window.desktop.saveConfig({ pet }).then(setState).catch((err) => setError(err.message || String(err)));
  function connectionText(source) {
    const row = state.activity.sources?.[source];
    const installed = state.connections?.[source];
    if (source !== 'dsh' && !installed?.ready) return installed?.enabled ? '待完成配置' : '未配置';
    if (row?.lastSeen) return statusLabels[row.status] || intentLabels[row.intent] || '已收到事件';
    if (installed?.ready) return '已配置 · 等待新事件';
    return source === 'dsh' ? '未连接' : '未接入';
  }
  function toggleAction(id) {
    const current = config.pools[pool] || [];
    const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id];
    save({ pools: { [pool]: next } });
  }
  const activity = state.activity;
  return <main className="shell">
    <header className="app-header">
      <div className="brand"><img src="/assets/logo.png" alt="" /><h1>鲸鱼桌宠</h1></div>
      <div className="header-actions"><button onClick={() => window.desktop.home()}>回家</button>
        <button onClick={() => save({ visible: !config.visible })}>{config.visible ? '隐藏' : '显示'}</button></div>
    </header>
    <nav className="tabs" aria-label="设置分类">
      {[['appearance', '外观'], ['actions', '动作'], ['connections', '连接']].map(([id, label]) =>
        <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setError(''); setNotice(''); }}>{label}</button>)}
    </nav>
    <div className="feedback" aria-live="polite">{error && <p className="error">{error}</p>}{notice && <p>{notice}</p>}</div>

    {tab === 'appearance' && <section className="appearance-grid">
      <div className="form-section">
        <label className="field"><span>大小 <output>{sizeDraft}</output></span><input type="range" min="200" max="800" step="10" value={sizeDraft}
          onPointerDown={() => { sizeEditing.current = true; }} onChange={(e) => setSizeDraft(Number(e.target.value))}
          onPointerUp={(e) => { sizeEditing.current = false; save({ size: Number(e.target.value) }); }} onKeyUp={(e) => save({ size: Number(e.target.value) })} /></label>
        <label className="field"><span>活跃程度</span><select value={Object.entries(runtime.ACTIVITY_PRESETS).find(([, p]) => p.moveProb === config.behavior.moveProb && p.actProb === config.behavior.actProb)?.[0] || 'balanced'}
          onChange={(e) => save({ behavior: runtime.ACTIVITY_PRESETS[e.target.value] })}><option value="quiet">安静</option><option value="balanced">均衡</option><option value="lively">活泼</option></select></label>
        <label className="field"><span>显示器</span><select value={state.displayId} onChange={(e) => run('display', async () => setState(await window.desktop.setDisplay(Number(e.target.value))))}>
          {state.displays.map((d) => <option key={d.id} value={d.id}>{d.label}{d.primary ? '（主屏）' : ''}</option>)}</select></label>
        <label className="field"><span>默认位置</span><select value={config.position} onChange={(e) => save({ position: e.target.value })}>
          <option value="bottom-right">右下</option><option value="bottom-left">左下</option><option value="top-right">右上</option><option value="top-left">左上</option></select></label>
        <label className="toggle-row"><span>状态气泡</span><input type="checkbox" checked={config.bubbles} onChange={(e) => save({ bubbles: e.target.checked })} /></label>
        <label className="toggle-row"><span>交互动效</span><input type="checkbox" checked={config.fx} onChange={(e) => save({ fx: e.target.checked })} /></label>
      </div>
      <div className="pet-preview"><video key="idle" src={runtime.animUrl('breathing')} autoPlay muted loop playsInline />
        <p>{activity.source ? `${activity.sourceLabel || sourceLabels[activity.source]} · ${intentLabels[activity.intent] || '处理中'}` : '自由活动'}</p></div>
      <div className="quiet-note">拖拽移动 · 单击回应 · 双击特殊动作 · 右键菜单</div>
    </section>}

    {tab === 'actions' && <section className="actions-layout">
      <div className="action-toolbar"><input type="search" aria-label="搜索动作" placeholder="搜索动作" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="动作分类" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">全部分类</option>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <button disabled={!!busy} onClick={() => run('import', async () => setState(await window.desktop.importActions()))}>{busy === 'import' ? '导入中…' : '导入动作'}</button></div>
      <div className="action-browser">
        <div><div className="pool-select"><label htmlFor="pool">加入</label><select id="pool" value={pool} onChange={(e) => setPool(e.target.value)}><option value="acts">自主动作池</option><option value="moves">移动动作池</option><option value="clicks">点击动作池</option></select></div>
          <div className="action-list">{filtered.map((a) => <div key={a.id} className={`action-row${selectedAction.id === a.id ? ' chosen' : ''}`}>
            <input type="checkbox" aria-label={`将${a.nameZh || a.id}加入动作池`} checked={(config.pools[pool] || []).includes(a.id)} onChange={() => toggleAction(a.id)} />
            <button className="action-name" onClick={() => setPreview(a.id)}>{a.nameZh || a.id}</button></div>)}
            {!filtered.length && <p className="empty">没有匹配的动作</p>}</div></div>
        <div className="action-detail"><div className="animation-stage"><video key={selectedAction.id} src={runtime.animUrl(selectedAction.id)} autoPlay muted loop playsInline /></div>
          <strong>{selectedAction.nameZh || selectedAction.id}</strong><div className="inline-actions"><button onClick={() => window.desktop.preview(selectedAction.id)}>让桌宠播放</button>
            {selectedAction.category === 'custom' && <button className="danger" onClick={() => run('remove', async () => setState(await window.desktop.removeAction(selectedAction.id)))}>删除</button>}</div></div>
      </div>
      <details className="mapping"><summary>工作状态对应动作</summary><div className="mapping-grid">{Object.entries(mappings).map(([key, label]) => <label key={key}><span>{label}</span><select value={config.intents[key]?.[0] || ''} onChange={(e) => save({ intents: { [key]: e.target.value ? [e.target.value] : [] } })}><option value="">自由活动</option>{actions.map((a) => <option key={a.id} value={a.id}>{a.nameZh || a.id}</option>)}</select></label>)}</div></details>
    </section>}

    {tab === 'connections' && <section className="connections">
      {[['codex', 'Codex 桌面端 / CLI'], ['claude', 'Claude Code']].map(([source, label]) => <div className="connection" key={source}>
        <div className="connection-line"><div><h2>{label}</h2><span className="status">{connectionText(source)}</span></div>
          <div className="inline-actions"><button className={state.connections[source]?.ready ? '' : 'primary'} disabled={!!busy} onClick={() => run(source, async () => {
            const next = await window.desktop.connect(source); setState(next);
          })}>{busy === source ? '配置中…' : state.connections[source]?.ready ? '重新配置' : '一键配置'}</button>
          {state.connections[source]?.hasInstalledHooks && <button disabled={!!busy} onClick={() => run(`${source}-remove`, async () => {
            setState(await window.desktop.disconnect(source)); setNotice(`${label} 接入配置已移除。`);
          })}>移除</button>}</div></div>
        {state.connections[source]?.enabled || state.connections[source]?.message !== '未接入'
          ? <p className="connection-note">{state.connections[source]?.message}</p>
          : <p className="connection-note">{source === 'codex' ? '点击后配置并授权桌宠 Hooks，仅发送本机工作状态。' : '点击后写入当前用户配置，保留已有设置。'}</p>}
        {source === 'codex' && (state.connections[source]?.enabled || state.connections[source]?.canChooseExecutable) && <button className="text-button" disabled={!!busy}
          onClick={() => run('select-codex', async () => setState(await window.desktop.selectCodex()))}>选择 codex.exe…</button>}
        <button className="text-button" onClick={() => window.desktop.openDocs(source)}>官方接入说明 ↗</button>
      </div>)}
      <div className="connection"><div className="connection-line"><div><h2>DeepSeek Harness</h2><span className="status">{connectionText('dsh')}</span></div>
        <button disabled={!!busy} onClick={() => run('dsh', async () => { const result = await window.desktop.exportBridge(); if (result) setNotice(`插件已导出，安装命令已复制：${result.command}。在 DSH 终端执行后，按 DSH 的提示重新加载插件。`); })}>{busy === 'dsh' ? '导出中…' : '导出桥接插件'}</button></div>
        <p className="connection-note">安装桥接后，保留一个已连接的 DSH 网页。</p></div>
      <div className="session-section"><h2>最近活动</h2><div className="session-list">{(activity.sessions || []).slice(0, 8).map((session, i) =>
        <div className="session-row" key={session.id || `${session.source}-${session.sessionId}-${i}`}><span>{sourceLabels[session.source] || session.source || '会话'}</span><span>{['ended','unknown','disconnected'].includes(session.status) ? statusLabels[session.status] : intentLabels[session.intent] || statusLabels[session.status] || '状态未知'}</span><code title={session.sessionId}>{String(session.sessionId || '').slice(-10)}</code></div>)}
        {!activity.sessions?.length && <p className="empty">尚未收到工作状态</p>}</div></div>
    </section>}
    <footer><button className="text-button" onClick={() => window.desktop.revealData()}>数据文件夹</button><span>WhalePet {state.version}</span></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
