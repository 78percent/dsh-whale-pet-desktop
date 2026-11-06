import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const name = 'whale-pet-desktop-bridge';
const inject = ['webServer'];
const ROUTE = '/whale-pet-desktop/api/bridge';
const BRIDGE_SESSION = '__dsh_bridge__';
const LEASE_MS = 30000;
const MAX_BODY = 65536;
const MAX_SESSIONS = 256;
const INTENTS = new Set([
    'IDLE', 'WORKING', 'CODING', 'READING', 'RESEARCHING', 'THINKING',
    'WAITING_USER', 'ERROR', 'LISTENING',
]);
const identifier = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9_.:@/#-]{1,200}$/.test(value) ? value : undefined;

function allowedRequest(req) {
    const peer = req.socket?.remoteAddress?.toLowerCase();
    if (peer !== '127.0.0.1' && peer !== '::1' && peer !== '::ffff:127.0.0.1') return false;
    if (req.headers['x-whale-pet-bridge'] !== '1') return false;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return false;
    try {
        const scheme = req.socket.encrypted ? 'https:' : 'http:';
        const own = new URL(`${scheme}//${req.headers.host}`);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(own.hostname)) return false;
        if (req.headers.origin && new URL(req.headers.origin).origin !== own.origin) return false;
        return true;
    } catch {
        return false;
    }
}

function reply(res, status, value) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(value));
}

async function readPacket(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('type');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new Error('size');
        chunks.push(chunk);
    }
    const packet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!identifier(packet?.pageId) || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1)
        throw new Error('packet');
    if (packet.type !== 'update' && packet.type !== 'disconnect') throw new Error('packet');
    if (!Array.isArray(packet.events) || packet.events.length > MAX_SESSIONS) throw new Error('packet');
    return packet;
}

// The browser never sees this path, endpoint or token. Re-read for desktop restarts.
async function connection() {
    const path = process.env.WHALE_PET_CONNECTION_FILE ||
        join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'WhalePetDesktop', 'connection.json');
    if ((await stat(path)).size > 16384) throw new Error('connection');
    const value = JSON.parse(await readFile(path, 'utf8'));
    const url = new URL(value.endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.pathname !== '/events' || url.search || url.hash || url.username || url.password ||
        typeof value.token !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(value.token)) {
        throw new Error('connection');
    }
    return { endpoint: url.href, token: value.token };
}

function normalized(event, page, packetSequence, index, now) {
    if (!event || event.kind !== 'snapshot') return undefined;
    const sessionId = identifier(event.sessionId);
    if (!sessionId || sessionId === BRIDGE_SESSION) return undefined;
    if (event.intent !== undefined && !INTENTS.has(event.intent)) return undefined;
    // Snapshot-without-intent means unknown, never implicit IDLE.
    const result = {
        source: 'dsh', client: 'unknown', sessionId,
        kind: event.kind,
        at: Number.isSafeInteger(event.at) ? Math.min(event.at, now) : now,
        eventId: `${page.id}:${packetSequence}:${index}`,
    };
    if (result.at < now - LEASE_MS) return undefined;
    if (event.intent !== undefined) result.intent = event.intent;
    return result;
}

function apply(ctx) {
    const pages = new Map();
    const closedPages = new Map();
    const observedActive = new Set();
    const outgoing = new Map();
    const instance = randomUUID();
    let counter = 0;
    let leader;
    let forwarding = false;
    let disposed = false;
    let lastAccepted = 0;
    let bridgeAt = 0;

    const bridgeEvent = (kind, sessionId = BRIDGE_SESSION) => ({
        source: 'dsh', client: 'unknown', sessionId, kind,
        eventId: `${instance}:${++counter}`,
        at: sessionId === BRIDGE_SESSION ? (bridgeAt = Math.max(Date.now(), bridgeAt + 1)) : Date.now(),
    });

    async function drain() {
        if (forwarding || !outgoing.size) return;
        forwarding = true;
        try {
            const target = await connection();
            while (outgoing.size) {
                const [key, event] = outgoing.entries().next().value;
                outgoing.delete(key);
                const response = await fetch(target.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
                    body: JSON.stringify(event), redirect: 'error', signal: AbortSignal.timeout(1200),
                });
                await response.body?.cancel();
                if (response.status !== 204) throw new Error('receiver');
                lastAccepted = Date.now();
            }
        } catch {
            // Do not retain old work to replay after a restart. The next live page
            // heartbeat includes current per-session snapshots and tries again.
            outgoing.clear();
            lastAccepted = 0;
        } finally {
            forwarding = false;
        }
    }

    function enqueue(event) {
        const key = (event.kind === 'session_end' ? 'end:' : 'state:') + event.sessionId;
        if (outgoing.size >= MAX_SESSIONS + 2 && !outgoing.has(key)) return;
        outgoing.set(key, event);
        void drain();
    }

    function elect(now) {
        for (const [id, closedAt] of closedPages) if (now - closedAt > LEASE_MS * 2) closedPages.delete(id);
        for (const [id, page] of pages) if (now - page.lastSeen > LEASE_MS) pages.delete(id);
        if (leader && !pages.has(leader)) {
            leader = undefined;
            outgoing.clear();
            enqueue(bridgeEvent('session_end'));
            // A successor page may not follow an old session that finished while
            // no page observed it. Do not revive that old activity on reconnect.
            for (const id of observedActive) enqueue(bridgeEvent('snapshot', id));
            observedActive.clear();
        }
        if (!leader) leader = pages.keys().next().value;
    }

    ctx.effect(() => ctx.webServer.register({
        kind: 'exact', path: ROUTE,
        handler: async (req, res) => {
            if (disposed) return reply(res, 503, { ok: false });
            if (req.method !== 'POST') return reply(res, 405, { ok: false });
            if (!allowedRequest(req)) return reply(res, 403, { ok: false });
            let packet;
            try { packet = await readPacket(req); }
            catch { return reply(res, 400, { ok: false }); }
            const now = Date.now();
            elect(now);
            let page = pages.get(packet.pageId);
            if (packet.type === 'disconnect') {
                if (!page || packet.sequence > page.sequence) {
                    pages.delete(packet.pageId);
                    closedPages.set(packet.pageId, now);
                }
                elect(now);
                return reply(res, 200, { ok: true, leader: false, desktopConnected: lastAccepted > now - LEASE_MS });
            }
            // A close notification can overtake an already in-flight update.
            if (closedPages.has(packet.pageId)) return reply(res, 200, { ok: true, leader: false, desktopConnected: false });
            if (!page) {
                if (pages.size >= 32) return reply(res, 429, { ok: false });
                page = { id: packet.pageId, sequence: 0, lastSeen: now };
                pages.set(page.id, page);
            }
            page.lastSeen = now;
            elect(now);
            const isLeader = leader === page.id;
            if (packet.sequence > page.sequence) {
                page.sequence = packet.sequence;
                if (isLeader) {
                    enqueue(bridgeEvent('heartbeat'));
                    packet.events.forEach((event, index) => {
                        const accepted = normalized(event, page, packet.sequence, index, now);
                        if (accepted) {
                            if (accepted.intent === 'IDLE') observedActive.delete(accepted.sessionId);
                            else if (observedActive.size < MAX_SESSIONS) observedActive.add(accepted.sessionId);
                            enqueue(accepted);
                        }
                    });
                }
            }
            reply(res, 200, { ok: true, leader: isLeader, desktopConnected: lastAccepted > now - LEASE_MS });
        },
    }), 'whale-pet-desktop: activity bridge');

    ctx.effect(() => {
        const timer = setInterval(() => elect(Date.now()), 5000);
        timer.unref?.();
        return () => {
            disposed = true;
            clearInterval(timer);
            pages.clear();
            closedPages.clear();
            outgoing.clear();
            if (leader) enqueue(bridgeEvent('session_end'));
            for (const id of observedActive) enqueue(bridgeEvent('snapshot', id));
            observedActive.clear();
            leader = undefined;
        };
    }, 'whale-pet-desktop: page leases');
}

export { apply, inject, name };
