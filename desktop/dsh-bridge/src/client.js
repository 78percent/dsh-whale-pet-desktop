import { resolveHostApi } from '../../../src/client/host-api.js';
import { createActivitySystem } from '../../../src/client/activity.js';

const ROUTE = '/whale-pet-desktop/api/bridge';
const HEARTBEAT_MS = 10000;
const identifier = (value) => {
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    return typeof text === 'string' && /^[A-Za-z0-9_.:@/#-]{1,200}$/.test(text) ? text : undefined;
};

function startBridge(api) {
    const { emptyIntentState, applyFrame, highestIntent } = createActivitySystem({ normalizeAnimId: (id) => id });
    const pageId = crypto.randomUUID();
    const sessions = new Map();
    const pending = new Map();
    let sequence = 0;
    let stopped = false;
    let leader = false;
    let stopSensor;
    let requestTimer;
    let inFlight = false;

    function queue(sessionId, record) {
        // Each snapshot is authoritative for the whole DSH session. Tool/turn
        // accounting stays in upstream applyFrame, never as overlapping desktop turns.
        const event = { sessionId, kind: 'snapshot', at: Date.now() };
        if (record.known) event.intent = highestIntent(record.state.active);
        pending.set(sessionId, event);
        if (!requestTimer && !stopped) requestTimer = setTimeout(() => { requestTimer = undefined; void flush(); }, 80);
    }

    function handle(raw) {
        const frame = raw?.payload || raw;
        const id = identifier(frame?.sessionId);
        if (!id || stopped) return;
        let record = sessions.get(id);
        if (!record) {
            if (sessions.size >= 256) {
                const idle = [...sessions].find(([, item]) => !item.known || highestIntent(item.state.active) === 'IDLE');
                if (idle) { clearTimeout(idle[1].errorTimer); sessions.delete(idle[0]); }
                else return;
            }
            record = { state: emptyIntentState(), known: false, lastSeq: -1 };
            sessions.set(id, record);
        }
        if (frame.type === 'activity/reset') {
            clearTimeout(record.errorTimer);
            record.errorTimer = undefined;
            if (record.completed) {
                record.state = emptyIntentState();
                record.known = true;
                queue(id, record);
                sessions.delete(id);
                return;
            }
            record.state = emptyIntentState();
            record.known = false;
            record.lastSeq = -1;
            queue(id, record);
            return;
        }
        const event = frame.event;
        if (frame.type === 'session/event') {
            if (Number.isSafeInteger(event?.seq)) {
                if (event.seq <= record.lastSeq) return;
                record.lastSeq = event.seq;
            }
        }
        const previous = record.known ? highestIntent(record.state.active) : undefined;
        record.state = applyFrame(record.state, frame, Date.now());
        if (frame.snapshot) delete record.state.active.ERROR;
        // Only recognized lifecycle data establishes a current state. Model
        // selection and usage records carry no activity authority.
        const relevant = frame.type === 'host/session-status' || frame.type === 'host/agent-error' ||
            /^(approval|question)\/requested$/.test(frame.type) ||
            (record.known && /^(approval|question)\/resolved$/.test(frame.type)) ||
            (frame.type === 'session/queue' && Array.isArray(frame.items) && frame.items.length > 0) ||
            (frame.type === 'session/event' && /^(turn\/(start|end)|step\/(start|end)|tool\/(call|result)|user\/message|assistant\/chunk|approval\/(asked|decided))$/.test(event?.type));
        if (!relevant) return;
        record.known = true;
        if (event?.type === 'turn/end') {
            record.state.running = false;
            record.completed = true;
        } else if (/^(turn\/start|step\/start|tool\/call|user\/message|assistant\/chunk)$/.test(event?.type) || frame.running === true ||
            /^(approval|question)\/requested$/.test(frame.type)) {
            record.completed = false;
        } else if (frame.type === 'host/session-status' && frame.running === false &&
            highestIntent(record.state.active) === 'IDLE') {
            record.completed = true;
        }
        if (record.state.active.ERROR && !record.errorTimer) {
            record.errorTimer = setTimeout(() => {
                record.errorTimer = undefined;
                delete record.state.active.ERROR;
                queue(id, record);
            }, 3000);
        }
        const next = highestIntent(record.state.active);
        if (next !== previous || event?.type === 'turn/start' || event?.type === 'turn/end') queue(id, record);
    }

    function unknownAll() {
        for (const [id, record] of sessions) {
            if (record.completed) continue;
            clearTimeout(record.errorTimer);
            record.errorTimer = undefined;
            record.known = false;
            record.state = emptyIntentState();
            record.lastSeq = -1;
            queue(id, record);
        }
    }

    function subscribeLegacy() {
        let controller;
        let reconnect;
        let disposed = false;
        const consume = async (stream, generation) => {
            try { for await (const frame of stream()) if (!generation.signal.aborted) handle(frame); }
            catch { /* The next subscription obtains fresh state. */ }
            if (disposed || generation.signal.aborted) return;
            unknownAll();
            clearTimeout(reconnect);
            reconnect = setTimeout(open, 2000);
        };
        const open = () => {
            controller?.abort();
            controller = new AbortController();
            const generation = controller;
            void consume(() => api.events.host({}, generation.signal), generation);
            void consume(() => api.events.mux({}, generation.signal), generation);
        };
        open();
        return () => { disposed = true; controller?.abort(); clearTimeout(reconnect); };
    }

    function setLeader(value) {
        if (leader === value) return;
        leader = value;
        if (leader) {
            sessions.clear();
            stopSensor = api.subscribeActivity ? api.subscribeActivity(handle, { scope: 'any', reconnectMs: 2000 }) : subscribeLegacy();
        } else {
            stopSensor?.();
            stopSensor = undefined;
            for (const record of sessions.values()) clearTimeout(record.errorTimer);
            sessions.clear();
            pending.clear();
        }
    }

    async function flush() {
        if (stopped || inFlight) return;
        clearTimeout(requestTimer);
        requestTimer = undefined;
        inFlight = true;
        const events = leader ? [...pending.values()] : [];
        pending.clear();
        try {
            const response = await fetch(ROUTE, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Whale-Pet-Bridge': '1' },
                body: JSON.stringify({ pageId, sequence: ++sequence, type: 'update', events }),
                signal: AbortSignal.timeout(2500),
            });
            if (!response.ok) throw new Error('bridge');
            const status = await response.json();
            if (!stopped) setLeader(status.ok === true && status.leader === true);
        } catch {
            // A disconnected page must not keep replaying a cached working state.
            if (!stopped) setLeader(false);
        } finally {
            inFlight = false;
            if (pending.size && !requestTimer && !stopped)
                requestTimer = setTimeout(() => { requestTimer = undefined; void flush(); }, 80);
        }
    }

    const heartbeat = setInterval(() => {
        if (leader) for (const [id, record] of sessions) queue(id, record);
        void flush();
    }, HEARTBEAT_MS);

    function disconnect() {
        if (stopped) return;
        stopped = true;
        setLeader(false);
        clearInterval(heartbeat);
        clearTimeout(requestTimer);
        window.removeEventListener('pagehide', disconnect);
        // keepalive permits normal tab-close delivery; lease expiry is the fallback.
        void fetch(ROUTE, {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Whale-Pet-Bridge': '1' },
            body: JSON.stringify({ pageId, sequence: ++sequence, type: 'disconnect', events: [] }),
        }).catch(() => {});
    }
    window.addEventListener('pagehide', disconnect);
    void flush();
    return disconnect;
}

function service(ctx, name) {
    try { return ctx.get(name); } catch { return undefined; }
}

function mount(ctx) {
    const connection = service(ctx, 'connection');
    const modern = !!(connection?.generation || connection?.state) || !connection;
    let remote;
    let remoteSession;
    try { remote = ctx.remote; } catch { remote = service(ctx, 'remote'); }
    try { remoteSession = remote?.session; } catch { remoteSession = service(ctx, 'remote.session'); }
    const api = resolveHostApi(connection, {
        modern, sessions: service(ctx, 'sessions'), remote, remoteSession,
        uiSession: service(ctx, 'uiSession'), getSettings: () => service(ctx, 'remote.settings'),
    });
    if (!api?.subscribeActivity && !(api?.events?.host && api?.events?.mux)) return;
    ctx.effect(() => {
        let stop = startBridge(api);
        const restore = (event) => {
            if (event.persisted) { stop(); stop = startBridge(api); }
        };
        window.addEventListener('pageshow', restore);
        return () => { window.removeEventListener('pageshow', restore); stop(); };
    }, 'whale-pet-desktop: browser activity');
}

window.__ModuleLoader__.load({
    id: '@whale-pet/desktop-bridge',
    factory: () => ({
        name: 'whale-pet-desktop-bridge',
        inject: [],
        apply(ctx) {
            const connection = service(ctx, 'connection');
            if (connection?.api) return mount(ctx);
            const modern = !!(connection?.generation || connection?.state) || !connection;
            return ctx.inject(
                modern ? ['remote', 'remote.session', 'sessions', 'uiSession'] : ['sessions', 'remote', 'uiSession'],
                (ready) => mount(ready),
            );
        },
    }),
});
