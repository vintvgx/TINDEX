/**
 * NetworkDiagnosticsService — in-app network + socket observability.
 *
 * Singleton, installed at startup via a bare import in app/_layout.tsx
 * (same pattern as LogService). Patches global.fetch and the WebSocket
 * constructor, recording every call into a capped ring buffer with:
 *   - timestamp, method, redacted URL, duration, status, bytes
 *   - the current screen (set by <DiagnosticsScreenTracker/>) and the
 *     initiating component/hook (parsed from a captured stack trace)
 *
 * Cost control (this must never become a perf problem itself):
 *   - Stack capture only happens after the Diagnostics UI has been opened at
 *     least once this session (`attributionArmed`).
 *   - Byte counting uses the content-length header only — bodies are never read.
 *   - The ring buffer caps at MAX_ENTRIES; subscribers are notified at most
 *     ~2x/sec via a trailing throttle.
 */

export type DiagMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'WS' | 'OTHER';

export interface DiagEntry {
  id: number;
  ts: number; // Date.now()
  method: DiagMethod;
  /** Redacted: path + non-sensitive query params only */
  url: string;
  /** Host, for spotting Alpaca/Yahoo/Supabase/Railway at a glance */
  host: string;
  durationMs?: number;
  status?: number;
  bytes?: number;
  /** Route/screen active when the call started, e.g. "dashboard" */
  screen: string;
  /** Initiating hook/component, e.g. "useAlpacaPositionValues" ("" if unknown) */
  source: string;
  error?: string;
}

export interface DiagSocket {
  id: number;
  url: string;
  screen: string;
  source: string;
  connectedAt: number;
  closedAt?: number;
  sent: number;
  received: number;
}

export interface DiagStats {
  reqPerMin: number;
  avgLatencyMs: number;
  slowCount: number; // >1000ms in window
  errorCount: number; // status >= 400 or throw, in window
  activeSockets: number;
}

const MAX_ENTRIES = 500;
const STATS_WINDOW_MS = 60_000;
const SLOW_MS = 1000;
// Query params that must never appear in a logged URL.
const SENSITIVE_PARAMS = /(key|token|secret|auth|password|signature)/i;

type Listener = () => void;

function redactUrl(raw: string): { url: string; host: string } {
  try {
    const u = new URL(raw, 'http://local');
    const params = new URLSearchParams(u.search);
    params.forEach((_v, k) => {
      if (SENSITIVE_PARAMS.test(k)) params.set(k, '…');
    });
    const qs = params.toString();
    return {
      url: u.pathname + (qs ? `?${qs}` : ''),
      host: u.hostname === 'local' ? '' : u.hostname,
    };
  } catch {
    return { url: String(raw).slice(0, 160), host: '' };
  }
}

/** First app-code frame in the stack: prefer hooks (useX), else components. */
function attributeSource(stack: string | undefined): string {
  if (!stack) return '';
  const frames = stack.split('\n');
  for (const f of frames) {
    const m = f.match(/at ([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    const name = m[1];
    if (name === 'attributeSource' || name === 'patchedFetch' || name === 'recordEntry') continue;
    if (/^(Object|Array|Promise|React|__)/.test(name)) continue;
    if (/^use[A-Z]/.test(name)) return name; // hook — most precise
    if (/^[A-Z]/.test(name)) return name; // component
  }
  return '';
}

class NetworkDiagnosticsService {
  private entries: DiagEntry[] = [];
  private sockets: DiagSocket[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;
  private socketSeq = 0;
  private currentScreen = 'unknown';
  private attributionArmed = false;
  private installed = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyPending = false;

  /** Call once the Diagnostics UI opens — enables stack capture from then on. */
  armAttribution() {
    this.attributionArmed = true;
  }

  setScreen(screen: string) {
    if (screen) this.currentScreen = screen;
  }

  getScreen() {
    return this.currentScreen;
  }

  install() {
    if (this.installed) return;
    this.installed = true;
    this.patchFetch();
    this.patchWebSocket();
  }

  // ── subscription (UI) ──────────────────────────────────────────────
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private scheduleNotify() {
    if (this.notifyTimer) {
      this.notifyPending = true;
      return;
    }
    this.emit();
    // Trailing throttle: UI re-renders at most ~2x/sec no matter the call rate.
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      if (this.notifyPending) {
        this.notifyPending = false;
        this.emit();
      }
    }, 500);
  }

  private emit() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* UI listener must never break recording */
      }
    });
  }

  getEntries(): DiagEntry[] {
    return this.entries;
  }

  getSockets(): DiagSocket[] {
    return this.sockets;
  }

  clear() {
    this.entries = [];
    this.sockets = [];
    this.emit();
  }

  getStats(): DiagStats {
    const cutoff = Date.now() - STATS_WINDOW_MS;
    let latSum = 0;
    let latN = 0;
    let slow = 0;
    let errors = 0;
    let n = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.ts < cutoff) break;
      n++;
      if (e.durationMs != null) {
        latSum += e.durationMs;
        latN++;
        if (e.durationMs > SLOW_MS) slow++;
      }
      if ((e.status != null && e.status >= 400) || e.error) errors++;
    }
    return {
      reqPerMin: n,
      avgLatencyMs: latN ? Math.round(latSum / latN) : 0,
      slowCount: slow,
      errorCount: errors,
      activeSockets: this.sockets.filter((s) => !s.closedAt).length,
    };
  }

  /** JSON export for sharing with Claude/dev. */
  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        screen: this.currentScreen,
        stats: this.getStats(),
        entries: this.entries.map((e) => ({ ...e, time: new Date(e.ts).toISOString() })),
        sockets: this.sockets,
      },
      null,
      2
    );
  }

  // ── recording ──────────────────────────────────────────────────────
  private recordEntry(partial: Omit<DiagEntry, 'id' | 'ts' | 'screen' | 'source'> & { source?: string }) {
    const entry: DiagEntry = {
      id: ++this.seq,
      ts: Date.now(),
      screen: this.currentScreen,
      source: partial.source ?? '',
      ...partial,
    } as DiagEntry;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.scheduleNotify();
  }

  private captureSource(): string {
    if (!this.attributionArmed) return '';
    try {
      return attributeSource(new Error().stack);
    } catch {
      return '';
    }
  }

  private patchFetch() {
    const origFetch = global.fetch.bind(global);
    const svc = this;
    async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const started = Date.now();
      let method: DiagMethod = 'GET';
      let rawUrl = '';
      try {
        if (typeof input === 'string') rawUrl = input;
        else if (input instanceof URL) rawUrl = input.toString();
        else {
          rawUrl = input.url;
          method = (input.method?.toUpperCase() as DiagMethod) || 'GET';
        }
        if (init?.method) method = init.method.toUpperCase() as DiagMethod;
      } catch {
        rawUrl = String(input).slice(0, 160);
      }
      const { url, host } = redactUrl(rawUrl);
      const source = svc.captureSource();
      try {
        const res = await origFetch(input as RequestInfo, init);
        let bytes: number | undefined;
        const cl = res.headers?.get?.('content-length');
        if (cl) {
          const parsed = parseInt(cl, 10);
          if (!Number.isNaN(parsed)) bytes = parsed;
        }
        svc.recordEntry({ method, url, host, durationMs: Date.now() - started, status: res.status, bytes, source });
        return res;
      } catch (err) {
        svc.recordEntry({
          method,
          url,
          host,
          durationMs: Date.now() - started,
          source,
          error: err instanceof Error ? err.message.slice(0, 120) : 'fetch failed',
        });
        throw err;
      }
    }
    (global as unknown as Record<string, unknown>).fetch = patchedFetch;
  }

  private patchWebSocket() {
    const OrigWS = (global as unknown as { WebSocket: typeof WebSocket }).WebSocket;
    if (!OrigWS) return;
    const svc = this;
    class TrackedWebSocket extends OrigWS {
      private diagId: number;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url as string, protocols as string[]);
        const { url: clean, host } = redactUrl(String(url));
        const rec: DiagSocket = {
          id: ++svc.socketSeq,
          url: host ? `${host}${clean}` : clean,
          screen: svc.getScreen(),
          source: svc.captureSource(),
          connectedAt: Date.now(),
          sent: 0,
          received: 0,
        };
        svc.sockets.push(rec);
        this.diagId = rec.id;
        svc.recordEntry({ method: 'WS', url: rec.url, host, source: rec.source });
        const prevOnClose = (this as unknown as Record<string, unknown>).onclose;
        this.addEventListener('close', () => {
          const s = svc.sockets.find((x) => x.id === this.diagId);
          if (s) s.closedAt = Date.now();
          svc.scheduleNotify();
        });
        void prevOnClose;
        this.addEventListener('message', () => {
          const s = svc.sockets.find((x) => x.id === this.diagId);
          if (s) {
            s.received++;
            // Notify occasionally so msg rates stay live without a render storm.
            if (s.received % 20 === 0) svc.scheduleNotify();
          }
        });
      }
      send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
        const s = svc.sockets.find((x) => x.id === this.diagId);
        if (s) s.sent++;
        return super.send(data as string);
      }
    }
    (global as unknown as Record<string, unknown>).WebSocket = TrackedWebSocket;
  }
}

export const networkDiagnostics = new NetworkDiagnosticsService();
