// frontend/js/services/bluetoothScanner.js
// Shared Bluetooth Scanner Service — BLE & SPP-over-BLE support
// Connects to Bluetooth barcode scanners and injects scans into the page input field.
//
// Supported protocols:
//   - BLE HID (keyboard emulation over Bluetooth LE)
//   - SPP-over-BLE (Serial Port Profile tunnelled over GATT)
//
// Usage:
//   import { BluetoothScannerService } from '../../services/bluetoothScanner.js';
//   const btScanner = new BluetoothScannerService(inputElement, onScanCallback);
//   // User clicks a "Connect BLE" button → btScanner.connect()

// Well-known GATT service/characteristic UUIDs used by barcode scanners
const SERIAL_SERVICE_UUID        = '00001101-0000-1000-8000-00805f9b34fb'; // SPP
const HID_SERVICE_UUID           = '00001812-0000-1000-8000-00805f9b34fb'; // HID
// Common vendor services used by scanners like Zebra, Socket Mobile, Honeywell, etc.
const VENDOR_SPP_SERVICE         = '0000fff0-0000-1000-8000-00805f9b34fb';
const VENDOR_NOTIFY_CHAR         = '0000fff1-0000-1000-8000-00805f9b34fb';
const VENDOR_WRITE_CHAR          = '0000fff2-0000-1000-8000-00805f9b34fb';
// Nordic UART Service (NUS) – widely used for SPP-over-BLE
const NORDIC_UART_SERVICE        = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR        = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notifications from device

// All services we accept when scanning for devices
const OPTIONAL_SERVICES = [
  HID_SERVICE_UUID,
  SERIAL_SERVICE_UUID,
  VENDOR_SPP_SERVICE,
  NORDIC_UART_SERVICE,
];

export class BluetoothScannerService {
  /**
   * @param {HTMLInputElement} inputElement – the text input to inject scans into
   * @param {Function} onScan – callback(barcodeString) fired after a complete scan
   */
  constructor(inputElement, onScan) {
    this._input = inputElement;
    this._onScan = onScan;
    this._device = null;
    this._server = null;
    this._characteristic = null;
    this._buffer = '';
    this._flushTimer = null; // Timeout to flush buffer if no terminator arrives
    this._state = 'disconnected'; // disconnected | connecting | connected
    this._listeners = [];        // state-change listeners
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 3;
    this._onDisconnectBound = this._onDisconnect.bind(this);
  }

  // ── Public API ──────────────────────────────────────────

  get state() { return this._state; }
  get deviceName() { return this._device?.name || null; }
  get isSupported() { return !!navigator.bluetooth; }

  /** Subscribe to state changes: cb('disconnected'|'connecting'|'connected') */
  onStateChange(cb) {
    this._listeners.push(cb);
    return () => { this._listeners = this._listeners.filter(l => l !== cb); };
  }

  /** Prompt user to pick a Bluetooth scanner and connect */
  async connect() {
    if (!this.isSupported) {
      throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge.');
    }

    this._setState('connecting');

    try {
      // Request device – user sees a browser picker dialog
      this._device = await navigator.bluetooth.requestDevice({
        // Accept any device advertising these services, or use acceptAllDevices
        // with optional services so the picker shows all BLE devices
        acceptAllDevices: true,
        optionalServices: OPTIONAL_SERVICES,
      });

      this._device.addEventListener('gattserverdisconnected', this._onDisconnectBound);

      this._server = await this._device.gatt.connect();
      this._reconnectAttempts = 0;

      // Try each known service in priority order
      const connected = await this._trySubscribe();
      if (!connected) {
        throw new Error('This scanner does not support BLE data mode. It is likely a Classic Bluetooth HID device — just focus the input field and scan (no button needed).');
      }

      this._setState('connected');
    } catch (err) {
      this._cleanup();
      this._setState('disconnected');
      // User cancelled the picker – not an error
      if (err.name === 'NotFoundError') return;
      throw err;
    }
  }

  /** Disconnect from the current device */
  disconnect() {
    if (this._device?.gatt?.connected) {
      this._device.gatt.disconnect();
    }
    this._cleanup();
    this._setState('disconnected');
  }

  destroy() {
    this.disconnect();
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

  /** Try each known GATT service and subscribe to notifications */
  async _trySubscribe() {
    // Log all available services for diagnostics
    try {
      const allServices = await this._server.getPrimaryServices();
      console.log(`[BLE Scanner] Device exposes ${allServices.length} GATT service(s):`);
      for (const svc of allServices) {
        console.log(`  - ${svc.uuid}`);
      }
    } catch (e) {
      console.warn('[BLE Scanner] Could not enumerate services:', e.message);
    }

    const attempts = [
      { service: NORDIC_UART_SERVICE, char: NORDIC_UART_TX_CHAR, label: 'Nordic UART' },
      { service: VENDOR_SPP_SERVICE,  char: VENDOR_NOTIFY_CHAR,  label: 'Vendor SPP' },
    ];

    for (const { service, char, label } of attempts) {
      try {
        const svc = await this._server.getPrimaryService(service);
        this._characteristic = await svc.getCharacteristic(char);
        await this._characteristic.startNotifications();
        this._characteristic.addEventListener('characteristicvaluechanged', (e) => this._onData(e));
        console.log(`[BLE Scanner] Subscribed via ${label}`);
        return true;
      } catch (_) {
        // Service not available on this device, try next
      }
    }

    // Fallback: enumerate all services and find any notify characteristic
    try {
      const services = await this._server.getPrimaryServices();
      for (const svc of services) {
        try {
          const chars = await svc.getCharacteristics();
          for (const c of chars) {
            if (c.properties.notify || c.properties.indicate) {
              this._characteristic = c;
              await c.startNotifications();
              c.addEventListener('characteristicvaluechanged', (e) => this._onData(e));
              console.log(`[BLE Scanner] Subscribed via fallback service ${svc.uuid} char ${c.uuid}`);
              return true;
            }
          }
        } catch (_) { /* skip */ }
      }
    } catch (_) { /* no services */ }

    return false;
  }

  /** Handle incoming BLE data (barcode bytes) */
  _onData(event) {
    const value = event.target.value; // DataView
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(value);

    // Accumulate into buffer; barcode scanners typically terminate with \r, \n, or \r\n
    this._buffer += chunk;

    // Clear any pending flush timer since new data arrived
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    // Process all complete barcodes in the buffer
    let terminatorIdx;
    let found = false;
    while ((terminatorIdx = this._buffer.search(/[\r\n]/)) >= 0) {
      const barcode = this._buffer.substring(0, terminatorIdx).trim();
      this._buffer = this._buffer.substring(terminatorIdx).replace(/^[\r\n]+/, '');
      found = true;

      if (barcode.length > 0) {
        this._injectScan(barcode);
      }
    }

    // If no terminator was found, start a flush timer.
    // Some scanners don't append \r\n — after 300ms of silence we
    // treat whatever is in the buffer as a complete barcode.
    if (!found && this._buffer.length > 0) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        const barcode = this._buffer.trim();
        this._buffer = '';
        if (barcode.length > 0) {
          console.log('[BLE Scanner] Flush timeout — emitting barcode:', barcode);
          this._injectScan(barcode);
        }
      }, 300);
    }
  }

  /** Inject barcode into the input element and trigger the scan callback */
  _injectScan(barcode) {
    if (this._input) {
      this._input.value = barcode;
    }
    if (this._onScan) {
      this._onScan(barcode);
    }
  }

  /** Handle unexpected disconnection — attempt auto-reconnect */
  async _onDisconnect() {
    console.warn('[BLE Scanner] Device disconnected');
    this._characteristic = null;
    this._server = null;

    if (this._reconnectAttempts < this._maxReconnectAttempts && this._device?.gatt) {
      this._reconnectAttempts++;
      this._setState('connecting');
      try {
        await new Promise(r => setTimeout(r, 1000));
        this._server = await this._device.gatt.connect();
        const ok = await this._trySubscribe();
        if (ok) {
          this._setState('connected');
          return;
        }
      } catch (_) { /* reconnect failed */ }
    }

    this._cleanup();
    this._setState('disconnected');
  }

  _cleanup() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._device) {
      this._device.removeEventListener('gattserverdisconnected', this._onDisconnectBound);
    }
    this._characteristic = null;
    this._server = null;
    this._device = null;
    this._buffer = '';
    this._reconnectAttempts = 0;
  }
}
