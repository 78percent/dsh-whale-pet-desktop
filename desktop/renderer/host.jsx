import React from 'react';
let runtime;
window.__ModuleLoader__ = {
  load({ factory }) {
    runtime = factory((name) => {
      if (name === 'react') return React;
      throw new Error(`Desktop does not load the DSH UI module: ${name}`);
    }).__internals;
  },
};
await import('../../src/client/index.js');
export { runtime, React };

export const intentLabels = {
  IDLE: '空闲', WORKING: '处理中', THINKING: '处理请求', CODING: '写代码 / 执行工具',
  READING: '阅读资料', RESEARCHING: '检索资料', WAITING_USER: '等待你处理',
  ERROR: '遇到错误', LISTENING: '收到任务',
};
export const sourceLabels = { codex: 'Codex', claude: 'Claude Code', dsh: 'DeepSeek Harness' };

export function makeStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    load: () => Promise.resolve(value),
    set(next) { value = next; listeners.forEach((fn) => fn(value)); return value; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
