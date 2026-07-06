// Record/replay WebSocket shim.
//
// Replaces globalThis.WebSocket with a fake that replays previously recorded
// messages (provided on globalThis.RECORDED_MESSAGES, one JSON object per line)
// instead of opening a real connection. Playback is paced using each message's
// `time_us` (microsecond) timestamp, and loops forever once the recording ends.
//
// It implements just enough of the WebSocket interface for the Python consumer:
// `new WebSocket(url)`, `binaryType`, `addEventListener`/`removeEventListener`,
// `send`, `close`, and dispatching `message`/`open`/`close` events whose `.data`
// holds the raw recorded line.

export class RecordReplayWebSocket {
  constructor(url) {
    this.url = url;
    this.binaryType = "blob";
    this.readyState = 0; // CONNECTING
    this._closed = false;
    this._listeners = { open: [], message: [], close: [], error: [] };

    const raw = globalThis.RECORDED_MESSAGES || "";
    this._lines = raw.split("\n").filter((line) => line.length > 0);

    // Defer startup so the caller can attach listeners first.
    setTimeout(() => this._run(), 0);
  }

  addEventListener(type, listener) {
    (this._listeners[type] ||= []).push(listener);
  }

  removeEventListener(type, listener) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(listener);
    if (i >= 0) arr.splice(i, 1);
  }

  _emit(type, event) {
    for (const fn of this._listeners[type] || []) fn(event);
    const on = this["on" + type];
    if (typeof on === "function") on(event);
  }

  send() {
    // No-op: this is a replay-only socket.
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3; // CLOSED
    this._emit("close", { code: 1000, reason: "", wasClean: true });
  }

  async _run() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    this.readyState = 1; // OPEN
    this._emit("open", {});

    // Loop the recording indefinitely.
    while (!this._closed) {
      let prevUs = null; // reset each loop so there's no delay at the seam
      for (const line of this._lines) {
        if (this._closed) return;

        let timeUs = null;
        try {
          timeUs = JSON.parse(line).time_us;
        } catch (e) {
          // Non-JSON or malformed line; emit immediately.
        }

        if (timeUs != null) {
          if (prevUs != null) {
            const delayMs = (timeUs - prevUs) / 1000; // us -> ms
            // Skip backwards jumps; cap long gaps so we don't stall.
            if (delayMs > 0) await sleep(10);
          }
          prevUs = timeUs;
        }

        if (this._closed) return;
        this._emit("message", { data: line });
      }
    }
  }
}

// Also install as the global for anyone reading `globalThis.WebSocket`.
globalThis.WebSocket = RecordReplayWebSocket;

export default RecordReplayWebSocket;
