import { useEffect, useRef } from 'react';
import { Cable } from 'lucide-react';
import type { Snapshot } from '../../shared/contracts';
import { Panel } from './ui';
import { useUsbStation } from './usbStation';

export function UsbStationPanel({ items }: { items: Snapshot['items'] }) {
  const { supported, phase, error, lines, lastTag, connect, disconnect } = useUsbStation();
  const log = useRef<HTMLPreElement>(null);
  const matched = lastTag && items.find(item => item.identifier?.trim().toUpperCase() === lastTag.uid);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines]);

  return <Panel title="ESP32 USB connection" className="usb-station"
    description="View RFID scans, IR triggers, and firmware messages from the ESP32."
    action={<button type="button" className={`button ${phase === 'connected' ? 'button-white' : 'button-gold'}`}
      disabled={!supported || phase === 'opening' || phase === 'closing'}
      onClick={() => { if (phase === 'connected') disconnect(); else void connect(); }}>
      <Cable size={16} aria-hidden="true" />
      {{ idle: 'Connect ESP32', opening: 'Connecting…', connected: 'Disconnect USB', closing: 'Disconnecting…' }[phase]}
    </button>}>
    <div className="usb-station-details">
      <span role="status" className={`tag ${phase === 'connected' ? 'tag-success' : 'tag-neutral'}`}>
        {phase === 'connected' ? 'USB connected' : 'USB disconnected'}
      </span>
      {lastTag && <p>Last RFID scan {lastTag.reader ? `· Reader ${lastTag.reader}` : ''} · <strong>{lastTag.uid}</strong>
        {' · '}{matched ? matched.name : 'Unregistered tag'}</p>}
    </div>
    {error && <p role="alert" className="usb-message">{error}</p>}
    {!supported && <p className="usb-message">Open LeaveMate in desktop Chrome or Edge to use USB serial.</p>}
    {supported && phase === 'idle' && !error && <p className="usb-message">Plug in the ESP32 and close Arduino Serial Monitor before connecting.</p>}
    {(phase === 'connected' || lines.length > 0) &&
      <pre ref={log} tabIndex={0} aria-label="ESP32 serial output" className="usb-log">{lines.length ? lines.join('\n') : 'Waiting for serial output…'}</pre>}
  </Panel>;
}
