import { MSG, safeParseJson } from '../shared/protocol.js';
import { decodeSnapshotBin } from '../shared/net/snapshot_bin.js';

export function createNetClient({ url }) {
  /** @type {WebSocket|null} */
  let ws = null;
  const listeners = new Set();
  const snapshotCtx = { players: null };
  const pending = [];

  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isConnected = false;
  let helloMsg = null; // Store the hello message for reconnection

  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 30000];

  function notifyListeners(msg) {
    for (const fn of listeners) {
      try {
        fn(msg);
      } catch (e) {
        console.error('Listener error:', e);
      }
    }
  }

  function setupWebSocket(resolve, reject) {
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      isConnected = true;
      reconnectAttempts = 0;

      // Flush messages queued before connect
      while (pending.length) {
        const msg = pending.shift();
        if (!msg) continue;
        ws.send(JSON.stringify(msg));
      }

      // If we have a stored hello message, resend it for reconnection
      if (helloMsg && reconnectAttempts === 0) {
        // First connection handled by caller
      }

      if (resolve) resolve();
      notifyListeners({ t: '_connected' });
    });

    ws.addEventListener('error', (e) => {
      console.error('WebSocket error:', e);
      if (reject && !isConnected) reject(e);
    });

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        const parsed = safeParseJson(ev.data);
        if (!parsed.ok) return;
        if (parsed.value?.t === MSG.MATCH_START && Array.isArray(parsed.value.players)) {
          snapshotCtx.players = parsed.value.players;
        }
        notifyListeners(parsed.value);
        return;
      }
      if (ev.data instanceof ArrayBuffer) {
        try {
          const snap = decodeSnapshotBin(ev.data, snapshotCtx);
          notifyListeners({ t: MSG.SNAPSHOT, snap });
        } catch {
          // ignore invalid frames
        }
        return;
      }
    });

    ws.addEventListener('close', (ev) => {
      isConnected = false;
      notifyListeners({ t: '_disconnected', code: ev.code, reason: ev.reason });
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      notifyListeners({ t: '_reconnect_failed' });
      return;
    }

    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    notifyListeners({ t: '_reconnecting', attempt: reconnectAttempts, delay });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      setupWebSocket(null, null);

      // Resend hello with reconnect token after reconnection
      if (helloMsg) {
        const checkOpen = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            clearInterval(checkOpen);
            ws.send(JSON.stringify(helloMsg));
          }
        }, 100);
        // Clear after 5 seconds if still not connected
        setTimeout(() => clearInterval(checkOpen), 5000);
      }
    }, delay);
  }

  function connect() {
    return new Promise((resolve, reject) => {
      setupWebSocket(resolve, reject);
    });
  }

  function send(msg) {
    // Store hello message for reconnection
    if (msg.t === MSG.HELLO) {
      helloMsg = msg;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pending.push(msg);
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  function onMessage(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getConnectionState() {
    return {
      isConnected,
      reconnectAttempts,
      readyState: ws?.readyState ?? WebSocket.CLOSED,
    };
  }

  return { connect, send, onMessage, getConnectionState };
}
