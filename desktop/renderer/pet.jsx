import { createRoot } from 'react-dom/client';
import { runtime, React, makeStore, intentLabels, sourceLabels } from './host.jsx';

let snapshot = await window.desktop.bootstrap();
const configStore = makeStore(runtime.mergeConfig({ ...snapshot.config.pet, scope: 'any', meter: false }));
const activityListeners = new Set();
let lastActivityKey;
const customStore = makeStore({ actions: snapshot.actions, display: '' });
runtime.setCustomAnims(snapshot.actions);
const api = {
  desktopMode: true,
  desktopSubscribeIntent(fn) {
    activityListeners.add(fn);
    fn(snapshot.activity.intent || 'IDLE');
    return () => activityListeners.delete(fn);
  },
  desktopStatusLabel() {
    const activity = snapshot.activity;
    return `${activity.sourceLabel || sourceLabels[activity.source] || ''} · ${intentLabels[activity.intent] || '处理中'}`;
  },
  desktopCommands: (fn) => window.desktop.onCommand(fn),
  desktopContextMenu: () => window.desktop.contextMenu(),
  settings: {
    update: ({ patch }) => window.desktop.saveConfig({ pet: patch }),
  },
};
window.desktop.onSnapshot((next) => {
  snapshot = next;
  configStore.set(runtime.mergeConfig({ ...next.config.pet, scope: 'any', meter: false }));
  runtime.setCustomAnims(next.actions);
  customStore.set({ actions: next.actions, display: '' });
  const activityKey = JSON.stringify([next.activity.source, next.activity.intent, next.config.pet.intents]);
  if (activityKey !== lastActivityKey) {
    lastActivityKey = activityKey;
    activityListeners.forEach((fn) => fn(next.activity.intent || 'IDLE'));
  }
});
createRoot(document.getElementById('root')).render(
  <runtime.WhalePet config={{}} store={configStore} customStore={customStore} api={api} />
);

// Keep native hit regions in step with the original component's animation/drag.
let lastGeometry = '', lastAt = 0, dragging = false;
function regions(at) {
  if (at - lastAt >= 40) {
    lastAt = at;
    const hit = document.querySelector('.wp-hit');
    const root = document.querySelector('.wp-root');
    const selected = !!root?.classList.contains('wp-selected');
    const rect = hit?.getBoundingClientRect();
    const data = { selected, regions: rect ? [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }] : [] };
    const serialized = JSON.stringify(data);
    if (serialized !== lastGeometry) { lastGeometry = serialized; window.desktop.hitRegions(data); }
  }
  requestAnimationFrame(regions);
}
requestAnimationFrame(regions);
document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.target.closest('.wp-hit')) return;
  const rect = document.querySelector('.wp-root').getBoundingClientRect();
  dragging = true;
  window.desktop.drag({ active: true, offsetX: event.clientX - rect.x - rect.width / 2,
    offsetY: event.clientY - rect.y - rect.height / 2 });
}, true);
const endDrag = () => { if (dragging) { dragging = false; window.desktop.drag({ active: false }); } };
document.addEventListener('pointerup', endDrag, true);
document.addEventListener('pointercancel', endDrag, true);
