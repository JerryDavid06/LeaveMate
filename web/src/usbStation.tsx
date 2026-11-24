import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type UsbPort = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

type Tag = { uid: string; reader?: number };
type Phase = 'idle' | 'opening' | 'connected' | 'closing';
type Connection = {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  stopping: boolean;
};
type UsbState = {
  supported: boolean;
  phase: Phase;
  error: string;
  lines: string[];
  lastTag: Tag | null;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  onTag: (listener: (tag: Tag) => void) => () => void;
};

const UsbContext = createContext<UsbState | null>(null);
const MAX_LINES = 100;
const MAX_LINE_LENGTH = 2048;

export function UsbStationProvider({ children }: { children: ReactNode }) {
  const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<UsbPort> } }).serial;
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [lastTag, setLastTag] = useState<Tag | null>(null);
  const active = useRef<Connection | null>(null);
  const opening = useRef(false);
  const generation = useRef(0);
  const listeners = useRef(new Set<(tag: Tag) => void>());

  useEffect(() => () => {
    generation.current++;
    const connection = active.current;
    if (connection) {
      connection.stopping = true;
      void connection.reader?.cancel().catch(() => {});
    }
  }, []);

  const onTag = useCallback((listener: (tag: Tag) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  async function connect() {
    if (!serial || active.current || opening.current) return false;
    const attempt = generation.current;
    opening.current = true;
    setPhase('opening');
    setError('');
    let port: UsbPort | undefined;
    let opened = false;

    try {
      port = await serial.requestPort();
      if (attempt !== generation.current) return false;
      await port.open({ baudRate: 115200 });
      opened = true;
      if (attempt !== generation.current) return false;
      const connection: Connection = { reader: null, stopping: false };
      active.current = connection;
      setLines([]);
      setLastTag(null);
      setPhase('connected');
      void readPort(port, connection, attempt);
      opened = false; // The read loop owns the port now.
      return true;
    } catch (cause) {
      if (attempt === generation.current && (!(cause instanceof DOMException) || cause.name !== 'NotFoundError')) {
        setError('Could not open the USB port. Close Arduino Serial Monitor or any app using it, then try again.');
      }
      return false;
    } finally {
      if (opened) await port?.close().catch(() => {});
      opening.current = false;
      if (!active.current && attempt === generation.current) setPhase('idle');
    }
  }

  async function readPort(port: UsbPort, connection: Connection, attempt: number) {
    const decoder = new TextDecoder();
    let pending = '';
    let discarding = false;

    function consume(text: string) {
      const parts = (pending + text).split('\n');
      pending = parts.pop() ?? '';
      const complete = parts.filter((part, index) => part.length <= MAX_LINE_LENGTH && !(index === 0 && discarding));
      if (parts.length) discarding = false;
      if (pending.length > MAX_LINE_LENGTH || discarding) {
        pending = '';
        discarding = true;
      }
      const nextLines = complete.map(line => line.trim()).filter(Boolean);
      if (nextLines.length) setLines(prior => [...prior, ...nextLines].slice(-MAX_LINES));
      for (const line of nextLines) {
        const match = /^(?:Reader (\d+) )?(?:RFID )?UID:\s*([0-9a-f]+(?:[ :\-][0-9a-f]+)*)\s*$/i.exec(line);
        if (!match) continue;
        const uid = match[2].replace(/[ :\-]/g, '').toUpperCase();
        if (![8, 14, 20].includes(uid.length)) continue;
        const tag: Tag = { uid, reader: match[1] ? Number(match[1]) : undefined };
        setLastTag(tag);
        listeners.current.forEach(listener => listener(tag));
      }
    }

    try {
      if (!port.readable) throw new Error('Serial input is unavailable.');
      const reader = port.readable.getReader();
      connection.reader = reader;
      while (!connection.stopping) {
        const { value, done } = await reader.read();
        if (connection.stopping || attempt !== generation.current) break;
        if (done) break;
        if (value) consume(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Disconnects and serial read errors share the same recovery.
    } finally {
      connection.reader?.releaseLock();
      await port.close().catch(() => {});
      if (active.current === connection) active.current = null;
      if (attempt === generation.current) {
        if (!connection.stopping) setError('USB serial input ended. Check the cable, then reconnect the ESP32.');
        setPhase('idle');
      }
    }
  }

  function disconnect() {
    const connection = active.current;
    if (!connection || connection.stopping) return;
    connection.stopping = true;
    setPhase('closing');
    void connection.reader?.cancel().catch(() => {});
  }

  return <UsbContext.Provider value={{ supported: !!serial, phase, error, lines, lastTag, connect, disconnect, onTag }}>
    {children}
  </UsbContext.Provider>;
}

export function useUsbStation() {
  const value = useContext(UsbContext);
  if (!value) throw new Error('USB station provider is missing.');
  return value;
}
