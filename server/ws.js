import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

function computeAccept(key) {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeFrame({ opcode, payload }) {
  const fin = 0x80;
  const first = fin | (opcode & 0x0f);
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = first;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function tryDecodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let len = second & 0x7f;
  let offset = 2;

  if (!fin) return { error: 'Fragmented frames not supported' };

  if (len === 126) {
    if (buffer.length < offset + 2) return null;
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { error: 'Frame too large' };
    len = Number(big);
    offset += 8;
  }

  let maskingKey = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + len) return null;
  let payload = buffer.subarray(offset, offset + len);
  const rest = buffer.subarray(offset + len);

  if (masked) {
    const unmasked = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) {
      unmasked[i] = payload[i] ^ maskingKey[i % 4];
    }
    payload = unmasked;
  }

  return { frame: { opcode, payload }, rest };
}

export function createWebSocketServer(httpServer, { path, onConnection }) {
  httpServer.on('upgrade', (req, socket, head) => {
    try {
      if (!req.url) {
        socket.destroy();
        return;
      }
      const url = new URL(req.url, 'http://local');
      if (url.pathname !== path) {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      const version = req.headers['sec-websocket-version'];
      if (typeof key !== 'string' || version !== '13') {
        socket.destroy();
        return;
      }

      const accept = computeAccept(key);
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n',
        ].join('\r\n'),
      );

      const ws = new WebSocketConnection(socket);
      if (head?.length) ws._onData(head);
      onConnection(ws);
    } catch {
      socket.destroy();
    }
  });
}

export class WebSocketConnection extends EventEmitter {
  #socket;
  #buffer = Buffer.alloc(0);
  #closed = false;

  constructor(socket) {
    super();
    this.#socket = socket;
    socket.on('data', (data) => this._onData(data));
    socket.on('close', () => this._onClose());
    socket.on('end', () => this._onClose());
    socket.on('error', (err) => this.emit('error', err));
  }

  _onData(data) {
    if (this.#closed) return;
    this.#buffer = Buffer.concat([this.#buffer, data]);
    while (true) {
      const decoded = tryDecodeFrame(this.#buffer);
      if (!decoded) return;
      if (decoded.error) {
        this.close(1002, decoded.error);
        return;
      }
      const { frame, rest } = decoded;
      this.#buffer = rest;
      this.#handleFrame(frame);
    }
  }

  _onClose() {
    if (this.#closed) return;
    this.#closed = true;
    this.emit('close');
  }

  #handleFrame(frame) {
    if (frame.opcode === 0x1) {
      this.emit('message', frame.payload.toString('utf8'));
      return;
    }
    if (frame.opcode === 0x2) {
      this.emit('message', frame.payload);
      return;
    }
    if (frame.opcode === 0x8) {
      this.close();
      return;
    }
    if (frame.opcode === 0x9) {
      // ping -> pong
      this.#socket.write(encodeFrame({ opcode: 0x0a, payload: frame.payload }));
      return;
    }
    // ignore other opcodes
  }

  sendText(text) {
    if (this.#closed) return;
    const payload = Buffer.from(text, 'utf8');
    this.#socket.write(encodeFrame({ opcode: 0x1, payload }));
  }

  sendBinary(buf) {
    if (this.#closed) return;
    const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.#socket.write(encodeFrame({ opcode: 0x2, payload }));
  }

  close(code = 1000, reason = 'bye') {
    if (this.#closed) return;
    this.#closed = true;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      this.#socket.write(encodeFrame({ opcode: 0x8, payload }));
    } finally {
      this.#socket.destroy();
    }
  }
}

