// frontend/js/services/serialScanner.js
// Serial Scanner Service — Classic SPP via Web Serial API
// Based on the proven WebSerialBarcodeScanner library pattern by Niels Leenheer.
//
// The scanner must be paired at the OS level first (it appears as a serial/COM port).
// Web Serial then opens that port directly from the browser.
//
// Usage:
//   import { SerialScannerService } from '../../services/serialScanner.js';
//   const serialScanner = new SerialScannerService(inputElement, onScanCallback);
//   // User clicks a button → serialScanner.connect()

const END_OF_TRANSMISSION_TIMEOUT = 300; // ms — same as reference library

export class SerialScannerService {
  /**
   * @param {HTMLInputElement} inputElement – the text input to inject scans into
   * @param {Function} onScan – callback(barcodeString) fired after a complete scan
   */
  constructor(inputElement, onScan) {
    this._input = inputElement;
    this._onScan = onScan;
    this._port = null;
    this._reader = null;
    this._buffer = [];          // Raw bytes buffer (like reference lib)
    this._timeout = null;       // End-of-transmission timer
    this._state = 'disconnected'; // disconnected | connecting | connected
    this._listeners = [];
    this._reading = false;

    // Listen for OS-level disconnect
    if (navigator.serial) {
      navigator.serial.addEventListener('disconnect', (event) => {
        if (this._port === event.target) {
          console.warn('[Serial Scanner] Device disconnected by OS');
          this._cleanup();
          this._setState('disconnected');
        }
      });
    }
  }

  // ── Public API ──────────────────────────────────────────

  get state() { return this._state; }
  get isSupported() { return !!navigator.serial; }

  /** Subscribe to state changes: cb('disconnected'|'connecting'|'connected') */
  onStateChange(cb) {
    this._listeners.push(cb);
    return () => { this._listeners = this._listeners.filter(l => l !== cb); };
  }

  /** Prompt user to select a serial port and connect */
  async connect() {
    if (!this.isSupported) {
      throw new Error('Web Serial is not supported in this browser. Use Chrome or Edge.');
    }

    this._setState('connecting');

    try {
      this._port = await navigator.serial.requestPort();

      const info = this._port.getInfo();
      console.log('[Serial Scanner] Port info:', JSON.stringify(info));

      await this._open(this._port);
    } catch (err) {
      this._cleanup();
      this._setState('disconnected');
      if (err.name === 'NotFoundError') return; // user cancelled picker
      throw err;
    }
  }

  /** Auto-reconnect to a previously used port (no user gesture needed) */
  async reconnect() {
    if (!this.isSupported) return;
    const ports = await navigator.serial.getPorts();
    if (ports.length === 1) {
      try {
        this._port = ports[0];
        this._setState('connecting');
        await this._open(this._port);
      } catch (_) {
        this._cleanup();
        this._setState('disconnected');
      }
    }
  }

  /** Disconnect and release the port */
  async disconnect() {
    this._reading = false;

    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    // MUST cancel first — this resolves the pending read() with {done: true}
    // then releaseLock, then close. Wrong order = port stays locked on macOS.
    if (this._reader) {
      try { await this._reader.cancel(); } catch (_) {}
      try { this._reader.releaseLock(); } catch (_) {}
      this._reader = null;
    }

    if (this._port) {
      try { await this._port.close(); } catch (_) {}
      this._port = null;
    }

    this._buffer = [];
    this._setState('disconnected');
    console.log('[Serial Scanner] Port closed gracefully');
  }

  async destroy() {
    await this.disconnect();
    this._listeners = [];
  }

  // ── Private ─────────────────────────────────────────────

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    for (const cb of this._listeners) {
      try { cb(s); } catch (_) { /* ignore */ }
    }
  }

  /** Open a serial port and start reading — mirrors reference library's open() */
  async _open(port) {
    // Match reference library defaults: 9600 8N1
    await port.open({
      baudRate:     9600,
      dataBits:     8,
      stopBits:     1,
      parity:       'none',
      flowControl:  'none',
      bufferSize:   255,
    });
    console.log('[Serial Scanner] Port opened: 9600 baud, 8N1, bufferSize=255');

    this._setState('connected');
    this._reading = true;

    // Continuous read loop — exact same pattern as reference library
    while (port.readable && this._reading) {
      this._reader = port.readable.getReader();
      console.log('[Serial Scanner] Reader acquired, waiting for data...');

      try {
        while (this._reading) {
          const { value, done } = await this._reader.read();

          // Cancel any pending timeout (new data arrived)
          if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
          }

          if (done) {
            console.log('[Serial Scanner] Reader done signal');
            this._reader.releaseLock();
            break;
          }

          if (value) {
            // Collect raw bytes (reference lib pattern)
            this._buffer.push(...value);
            console.log('[Serial Scanner] 📦 Data received — bytes:', value.byteLength,
              '| hex:', Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' '),
              '| text:', JSON.stringify(String.fromCharCode(...value)));
          }

          // Set timeout — when no more data arrives within 300ms,
          // treat buffer contents as a complete barcode
          this._timeout = setTimeout(() => {
            this._timeout = null;
            this._parse(this._buffer);
            this._buffer = [];
          }, END_OF_TRANSMISSION_TIMEOUT);
        }
      } catch (err) {
        if (this._reading) {
          console.error('[Serial Scanner] Read error:', err);
        }
        this._buffer = [];
      }
    }

    // If we exited the while loop without intentionally stopping, port disconnected
    if (this._reading) {
      console.warn('[Serial Scanner] Port lost readable');
      this._cleanup();
      this._setState('disconnected');
    }
  }

  /** Parse raw byte buffer into barcode string and emit */
  _parse(buffer) {
    if (buffer.length === 0) return;

    let barcode = String.fromCharCode.apply(null, buffer);

    // Strip trailing CR/LF
    if (barcode.endsWith('\n')) barcode = barcode.slice(0, -1);
    if (barcode.endsWith('\r')) barcode = barcode.slice(0, -1);

    barcode = barcode.trim();

    if (barcode.length > 0) {
      console.log('[Serial Scanner] ✅ Barcode:', barcode);
      this._injectScan(barcode);
    }
  }

  /** Inject barcode into the input element and fire callback */
  _injectScan(barcode) {
    if (this._input) {
      this._input.value = barcode;
    }
    if (this._onScan) {
      this._onScan(barcode);
    }
  }

  async _cleanup() {
    this._reading = false;
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    if (this._reader) {
      try { await this._reader.cancel(); } catch (_) {}
      try { this._reader.releaseLock(); } catch (_) {}
      this._reader = null;
    }
    if (this._port) {
      try { await this._port.close(); } catch (_) {}
      this._port = null;
    }
    this._buffer = [];
  }
}
