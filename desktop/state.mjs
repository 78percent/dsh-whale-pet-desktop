const SOURCES = ['codex', 'claude', 'dsh'];
const LABELS = { codex: 'Codex', claude: 'Claude Code', dsh: 'DeepSeek Harness' };
const INTENTS = new Set(['IDLE', 'WORKING', 'CODING', 'READING', 'RESEARCHING', 'THINKING', 'WAITING_USER', 'ERROR', 'LISTENING']);
const KINDS = new Set(['session_start', 'prompt', 'model_start', 'model_end', 'tool_start', 'tool_end', 'waiting', 'done', 'error', 'interrupt', 'session_end', 'heartbeat', 'snapshot']);
const BRIDGE_SESSION = '__dsh_bridge__';
const UNKNOWN_AFTER = 120_000;
const BRIDGE_TIMEOUT = 45_000;
const ERROR_DISPLAY = 5_000;
const MIN_DISPLAY = 1_200;

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
}

function rank(row) {
  if (row.intent === 'ERROR') return 3;
  if (row.intent === 'WAITING_USER') return 2;
  return row.intent !== 'IDLE' && row.status === 'working' ? 1 : 0;
}

/** In-memory metadata only. A quiet hook stream becomes unknown, never successful. */
export function createActivityStore() {
  const sessions = new Map();
  const seen = new Map();
  const sourceMeta = Object.fromEntries(SOURCES.map(source => [source, { lastSeen: 0 }]));
  const listeners = new Set();
  let bridge = { lastSeen: 0, endedAt: 0 };
  let selected = null;
  let selectedIntent = 'IDLE';
  let selectedRank = 0;
  let selectedAt = 0;
  let closed = false;
  let previousSnapshot = '';

  function turnFor(session, event, at) {
    const key = event.turnId || '__unscoped__';
    let turn = session.turns.get(key);
    // Older integrations without a turn id may start again only on an explicit
    // new prompt or an authoritative DSH snapshot, never on a delayed tool hook.
    if (!turn || (turn.closed && !event.turnId && at > turn.closedAt &&
      (event.kind === 'prompt' || (event.source === 'dsh' && event.kind === 'snapshot' && event.intent)))) {
      turn = { id: event.turnId, tools: new Map(), finishedTools: new Set(), active: false,
        waits: new Map(), unknown: false, closed: false, closedAt: 0, intent: 'WORKING', lastSeen: at,
        modelAt: 0, snapshotAt: 0, errorAt: 0, errorUntil: 0 };
      session.turns.set(key, turn);
    }
    return turn;
  }

  function sessionRow(session, now) {
    const disconnected = session.source === 'dsh' &&
      (!bridge.lastSeen || bridge.endedAt >= bridge.lastSeen || now - bridge.lastSeen > BRIDGE_TIMEOUT);
    const turns = [...session.turns.values()];
    const active = turns.filter(turn => turn.active && !turn.closed);
    const errors = turns.filter(turn => turn.errorUntil > now);
    const waiting = active.filter(turn => turn.waits.size);
    let intent = 'IDLE';
    let status = session.endedAt ? 'ended' : 'idle';
    let chosen = null;
    if (active.length) {
      chosen = active.sort((a, b) => b.lastSeen - a.lastSeen)[0];
      status = 'working';
      const tools = active.flatMap(turn => [...turn.tools.values()]).sort((a, b) => b.at - a.at);
      intent = tools[0]?.intent || chosen.intent || 'WORKING';
      if (intent === 'IDLE' || intent === 'ERROR' || intent === 'WAITING_USER') intent = 'WORKING';
    }
    if (waiting.length) {
      chosen = waiting.sort((a, b) => b.lastSeen - a.lastSeen)[0];
      status = 'waiting';
      intent = 'WAITING_USER';
    }
    if (errors.length) {
      chosen = errors.sort((a, b) => b.errorAt - a.errorAt)[0];
      status = 'error';
      intent = 'ERROR';
    }
    // Heartbeats prove transport liveness, not task completion or activity.
    if (!errors.length && !session.endedAt &&
      (session.unknown || (!waiting.length && active.some(turn => turn.unknown || now - turn.lastSeen > UNKNOWN_AFTER)) ||
        (!active.length && now - session.lastSeen > UNKNOWN_AFTER))) {
      status = 'unknown';
      intent = 'IDLE';
    }
    if (disconnected) { status = 'disconnected'; intent = 'IDLE'; }
    return {
      source: session.source, sourceLabel: LABELS[session.source], sessionId: session.id,
      client: session.client, ...(chosen?.id ? { turnId: chosen.id } : {}),
      status, intent, lastSeen: session.lastSeen, lastError: session.lastError || null,
      activeTools: active.flatMap(turn => [...turn.tools.keys()]),
      activeTurns: active.map(turn => turn.id).filter(Boolean),
    };
  }

  function snapshot() {
    const now = Date.now();
    const rows = [...sessions.values()].map(session => sessionRow(session, now))
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const candidates = rows.filter(row => rank(row) > 0)
      .sort((a, b) => rank(b) - rank(a) || b.lastSeen - a.lastSeen);
    let current = candidates[0];
    const held = candidates.find(row => `${row.source}\0${row.sessionId}` === selected);
    if (held && current && selectedRank === rank(held) && rank(held) === rank(current) && now - selectedAt < MIN_DISPLAY) {
      current = { ...held, intent: selectedIntent };
    }
    const nextKey = current ? `${current.source}\0${current.sessionId}` : null;
    if (nextKey !== selected || (current?.intent || 'IDLE') !== selectedIntent) {
      selected = nextKey; selectedIntent = current?.intent || 'IDLE'; selectedRank = current ? rank(current) : 0; selectedAt = now;
    }
    const sources = Object.fromEntries(SOURCES.map(source => {
      const own = rows.filter(row => row.source === source);
      const busy = own.filter(row => rank(row) > 0).sort((a, b) => rank(b) - rank(a) || b.lastSeen - a.lastSeen)[0];
      let status = busy?.status || (own.some(row => row.status === 'unknown') ? 'unknown' :
        own.length ? 'idle' : 'disconnected');
      if (own.length && own.every(row => row.status === 'ended')) status = 'disconnected';
      if (source === 'dsh') {
        const live = bridge.lastSeen && bridge.endedAt < bridge.lastSeen && now - bridge.lastSeen <= BRIDGE_TIMEOUT;
        if (!live) status = 'disconnected';
        else if (!own.length) status = 'connected';
      } else if (status !== 'disconnected' && !busy && sourceMeta[source].lastSeen && now - sourceMeta[source].lastSeen > UNKNOWN_AFTER) {
        status = 'unknown';
      }
      return [source, { source, sourceLabel: LABELS[source], status,
        intent: status === 'disconnected' || status === 'unknown' ? 'IDLE' : busy?.intent || 'IDLE',
        lastSeen: sourceMeta[source].lastSeen || null, sessionCount: own.length }];
    }));
    return { intent: current?.intent || 'IDLE', source: current?.source || null,
      sourceLabel: current?.sourceLabel || '', sessions: rows, sources };
  }

  function publish() {
    if (closed) return;
    const value = snapshot();
    const encoded = JSON.stringify(value);
    if (encoded === previousSnapshot) return;
    previousSnapshot = encoded;
    for (const listener of listeners) {
      try { listener(value); } catch { /* A renderer subscriber cannot interrupt ingestion. */ }
    }
  }

  function ingest(input) {
    if (closed || !input || !SOURCES.includes(input.source) || !KINDS.has(input.kind)) return false;
    const sessionId = identifier(input.sessionId);
    if (!sessionId) return false;
    const now = Date.now();
    const at = Number.isFinite(input.at) && input.at > 0 ? Math.min(input.at, now) : now;
    const event = { source: input.source, kind: input.kind, sessionId,
      turnId: identifier(input.turnId), toolId: identifier(input.toolId),
      eventId: identifier(input.eventId), intent: INTENTS.has(input.intent) ? input.intent : undefined,
      client: ['desktop', 'cli'].includes(input.client) ? input.client : 'unknown' };
    if (event.eventId) {
      const id = `${event.source}\0${event.sessionId}\0${event.eventId}`;
      if (seen.has(id)) return false;
      seen.set(id, now);
      if (seen.size > 20_000) seen.delete(seen.keys().next().value);
    }
    sourceMeta[event.source].lastSeen = Math.max(sourceMeta[event.source].lastSeen, at);
    if (event.source === 'dsh' && sessionId === BRIDGE_SESSION) {
      if (event.kind === 'session_end') bridge.endedAt = Math.max(bridge.endedAt, at);
      else if (event.kind === 'heartbeat' || event.kind === 'session_start') {
        const wasDisconnected = bridge.endedAt >= bridge.lastSeen || now - bridge.lastSeen > BRIDGE_TIMEOUT;
        if (wasDisconnected && at > bridge.lastSeen) {
          // A newly connected page must re-observe its own sessions. An old
          // active snapshot from a vanished page is not evidence of new work.
          for (const session of sessions.values()) {
            if (session.source === 'dsh' && !session.endedAt) session.unknown = true;
          }
        }
        bridge.lastSeen = Math.max(bridge.lastSeen, at);
      }
      publish();
      return true;
    }
    const key = `${event.source}\0${sessionId}`;
    let session = sessions.get(key);
    if (!session) {
      session = { source: event.source, id: sessionId, client: event.client, lastSeen: at,
        endedAt: 0, unknown: false, turns: new Map(), lastError: 0 };
      sessions.set(key, session);
    }
    if (session.endedAt) {
      if (!['session_start', 'prompt'].includes(event.kind) || at <= session.endedAt) return false;
      session.endedAt = 0;
    }
    session.lastSeen = Math.max(session.lastSeen, at);
    if (event.client !== 'unknown') session.client = event.client;
    if (event.kind === 'session_end') {
      session.endedAt = at;
      for (const turn of session.turns.values()) {
        turn.active = false; turn.closed = true; turn.closedAt = at; turn.tools.clear(); turn.waits.clear();
      }
      publish();
      return true;
    }
    if (event.kind === 'heartbeat') { publish(); return true; }
    if (event.kind === 'session_start') { session.unknown = false; publish(); return true; }
    const turn = turnFor(session, event, at);
    if (turn.closed) return false;
    // A missing snapshot is an explicit loss of observation, not an idle snapshot.
    if (event.kind === 'snapshot' && !event.intent) {
      if (at >= turn.snapshotAt) { turn.unknown = true; session.unknown = true; turn.snapshotAt = at; }
      publish();
      return true;
    }
    if (event.kind === 'snapshot' && at < turn.snapshotAt) return false;
    if (!['tool_end', 'error', 'done', 'interrupt'].includes(event.kind) && at < turn.lastSeen && event.kind !== 'tool_start') return false;
    const fresh = at >= turn.lastSeen;
    turn.lastSeen = Math.max(turn.lastSeen, at);
    session.unknown = false;
    turn.unknown = false;
    const clearWait = () => {
      const waitKey = event.toolId || '__turn__';
      if ((turn.waits.get(waitKey) || 0) <= at) turn.waits.delete(waitKey);
      if ((turn.waits.get('__turn__') || 0) <= at) turn.waits.delete('__turn__');
    };
    const resume = () => {
      turn.active = true;
      clearWait();
      if (fresh) turn.intent = event.intent || 'WORKING';
    };
    switch (event.kind) {
      case 'prompt': resume(); turn.waits.clear(); break;
      case 'model_start': resume(); turn.waits.clear(); turn.modelAt = at; break;
      case 'model_end':
        turn.active = true;
        if (at >= turn.modelAt) { turn.modelAt = 0; if (fresh) turn.intent = 'WORKING'; }
        break;
      case 'tool_start':
        if (event.toolId && turn.finishedTools.has(event.toolId)) break;
        resume();
        if (event.toolId) turn.tools.set(event.toolId, { intent: event.intent || 'WORKING', at });
        break;
      case 'tool_end':
        turn.active = true;
        if (event.toolId) { turn.tools.delete(event.toolId); turn.finishedTools.add(event.toolId); }
        clearWait();
        if (fresh) turn.intent = 'WORKING';
        break;
      case 'waiting':
        turn.active = true; turn.waits.set(event.toolId || '__turn__', at);
        break;
      case 'snapshot':
        turn.snapshotAt = at;
        turn.active = event.intent !== 'IDLE';
        turn.waits.clear();
        if (event.intent === 'WAITING_USER') turn.waits.set('__turn__', at);
        if (event.intent === 'ERROR' && turn.intent === 'ERROR' && turn.errorAt) break;
        turn.intent = event.intent;
        if (!turn.active) turn.tools.clear();
        if (event.intent !== 'ERROR') break;
        // A snapshot can report an explicit source error without forwarding its text.
      case 'error':
        turn.errorAt = Math.max(turn.errorAt, at);
        turn.errorUntil = Math.max(turn.errorUntil, at + ERROR_DISPLAY);
        session.lastError = Math.max(session.lastError, at);
        if (event.toolId) { turn.tools.delete(event.toolId); turn.finishedTools.add(event.toolId); }
        break;
      case 'done':
      case 'interrupt':
        turn.active = false; turn.closed = true; turn.closedAt = at; turn.waits.clear(); turn.tools.clear();
        break;
    }
    publish();
    return true;
  }

  const ticker = setInterval(publish, 1000);
  ticker.unref?.();
  return {
    ingest, snapshot,
    onChange(fn) {
      if (typeof fn !== 'function' || closed) return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() { closed = true; clearInterval(ticker); listeners.clear(); sessions.clear(); seen.clear(); },
  };
}
