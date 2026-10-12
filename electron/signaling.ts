import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import Bonjour = require('bonjour-service');
type BonjourInstance = InstanceType<typeof Bonjour>;
type Service = ReturnType<BonjourInstance['publish']>;

/**
 * SignalingServer
 *
 * Hosts the companion mobile web app on the LAN and brokers WebRTC signaling
 * between it and the desktop renderer. The renderer owns the
 * RTCPeerConnection (browser-only API); main owns the transport.
 *
 * One desktop, one phone at a time. The phone authenticates with a pairing
 * code shown on the desktop (and embedded in a QR). The code applies to:
 *   - the companion HTML page (?code=...)
 *   - the WebSocket handshake (?code=...)
 *
 * Static assets (the bundled JS/CSS for the companion app) are not gated by
 * the code, so subsequent asset loads from the phone don't require a session
 * cookie. The pairing code stays single-use until the server is restarted.
 *
 * In dev mode the HTTP server proxies asset requests to the Vite dev server
 * so the phone gets HMR-fresh code. In prod it serves from dist/.
 */

export interface PairingInfo {
  code: string;
  url: string;
  host: string;
  port: number;
}

type PhoneMessageListener = (msg: unknown) => void;

export class SignalingServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private bonjour: BonjourInstance | null = null;
  private bonjourService: Service | null = null;

  private code: string | null = null;
  private host: string | null = null;
  private port = 0;
  private phoneSocket: WebSocket | null = null;
  private listeners = new Set<PhoneMessageListener>();

  private isDev: boolean;
  private distDir: string;
  private viteDevPort: number;

  constructor(opts: { isDev: boolean; distDir: string; viteDevPort?: number }) {
    this.isDev = opts.isDev;
    this.distDir = opts.distDir;
    this.viteDevPort = opts.viteDevPort ?? 5173;
  }

  async start(): Promise<PairingInfo> {
    if (this.httpServer) return this.info()!;

    this.code = makePairingCode();
    this.host = pickLanAddress();

    this.httpServer = http.createServer((req, res) => this.onHttp(req, res));
    await new Promise<void>((resolve, reject) => {
      const errH = (e: Error) => reject(e);
      this.httpServer!.once('error', errH);
      this.httpServer!.listen(0, '0.0.0.0', () => {
        this.httpServer!.off('error', errH);
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        resolve();
      });
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.wss.on('connection', (sock, req) => this.onWsConnection(sock, req));

    try {
      this.bonjour = new Bonjour();
      this.bonjourService = this.bonjour.publish({
        name: 'Piano Canva Overhead',
        type: 'pianokeys-signal',
        protocol: 'tcp',
        port: this.port,
        txt: { v: '1' },
      });
    } catch (err) {
      // mDNS is a nice-to-have; QR pairing works without it.
      console.warn('[signaling] mDNS publish failed', err);
    }

    return this.info()!;
  }

  async stop(): Promise<void> {
    if (this.phoneSocket) {
      try { this.phoneSocket.close(); } catch { /* ignore */ }
    }
    this.phoneSocket = null;

    if (this.bonjourService) {
      try { this.bonjourService.stop(); } catch { /* ignore */ }
      this.bonjourService = null;
    }
    if (this.bonjour) {
      try { this.bonjour.destroy(); } catch { /* ignore */ }
      this.bonjour = null;
    }

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }

    this.code = null;
    this.host = null;
    this.port = 0;
  }

  info(): PairingInfo | null {
    if (!this.code || !this.host || !this.port) return null;
    return {
      code: this.code,
      host: this.host,
      port: this.port,
      url: `http://${this.host}:${this.port}/companion.html?code=${encodeURIComponent(this.code)}`,
    };
  }

  onPhoneMessage(cb: PhoneMessageListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sendToPhone(msg: unknown): void {
    if (this.phoneSocket?.readyState === WebSocket.OPEN) {
      this.phoneSocket.send(JSON.stringify(msg));
    }
  }

  private onWsConnection(sock: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const codeParam = url.searchParams.get('code');
    if (codeParam !== this.code) {
      sock.close(4001, 'invalid pairing code');
      return;
    }
    if (this.phoneSocket && this.phoneSocket.readyState === WebSocket.OPEN) {
      // Latest phone wins.
      this.phoneSocket.close(4002, 'replaced by newer pairing');
    }
    this.phoneSocket = sock;
    sock.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        for (const cb of this.listeners) cb(msg);
      } catch {
        /* ignore malformed */
      }
    });
    sock.on('close', () => {
      if (this.phoneSocket === sock) this.phoneSocket = null;
    });
    sock.on('error', () => {
      sock.terminate();
    });
    // Notify the renderer that a phone is online.
    for (const cb of this.listeners) cb({ type: 'phone-connected' });
  }

  private onHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Only the HTML page is gated; static assets are open so subsequent loads
    // from the phone don't need to re-pass the code.
    const isHtmlPage = pathname === '/' || pathname === '/companion.html';
    if (isHtmlPage) {
      const codeParam = url.searchParams.get('code');
      if (codeParam !== this.code) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Pairing required.');
        return;
      }
    }

    if (this.isDev) {
      this.proxyToVite(req, res, pathname === '/' ? '/companion.html' + url.search : req.url!);
    } else {
      this.serveStatic(req, res, pathname === '/' ? '/companion.html' : pathname);
    }
  }

  private proxyToVite(req: http.IncomingMessage, res: http.ServerResponse, target: string) {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: this.viteDevPort,
      path: target,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${this.viteDevPort}` },
    };
    const upstream = http.request(opts, (uRes) => {
      res.writeHead(uRes.statusCode ?? 502, uRes.headers);
      uRes.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Vite dev server unavailable.');
    });
    req.pipe(upstream);
  }

  private serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    const filePath = path.join(this.distDir, pathname);
    if (!filePath.startsWith(this.distDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': guessContentType(filePath),
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  }
}

function makePairingCode(): string {
  // Crockford-style alphabet — no 0/O/1/I confusion.
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

function pickLanAddress(): string {
  const ifaces = os.networkInterfaces();
  // Prefer en0/eth0-style interfaces before others.
  const ordered: string[] = [];
  for (const name of Object.keys(ifaces)) {
    if (/^(en|eth|wlan|wlp)/i.test(name)) ordered.unshift(name);
    else ordered.push(name);
  }
  for (const name of ordered) {
    const list = ifaces[name] ?? [];
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal && info.address) return info.address;
    }
  }
  return '127.0.0.1';
}

function guessContentType(p: string): string {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
