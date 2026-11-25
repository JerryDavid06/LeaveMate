import { useState, type FormEvent } from 'react';
import { Cable, CircleAlert, Volume2 } from 'lucide-react';
import type { Settings as Preferences, Snapshot } from '../../shared/contracts';
import { api, dateTime, type Action } from './lib';
import { Dialog, ModeTag, Switch } from './ui';
import type { VoiceControls } from './voice';

const tabs = ['General', 'Voice alerts', 'Device', 'System'] as const;
export function Settings({ state, act, voice, close }: { state: Snapshot; act: Action; voice: VoiceControls; close: () => void }) {
  const [tab, setTab] = useState<typeof tabs[number]>('General');
  const [form, setForm] = useState(state.settings);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState('');
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setForm((prior) => ({ ...prior, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await act(async () => { await api('/settings', 'PUT', form); return true; }, 'Settings saved.');
    setBusy(false);
    if (result) close();
  }

  return <Dialog title="Settings" wide onClose={() => { if (!busy) close(); }}>
    <div className="segmented settings-tabs" aria-label="Settings sections">{tabs.map((label) =>
      <button type="button" key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</button>)}</div>
    <form className="form-stack settings-body" onSubmit={save}>
      {tab === 'General' && <>
        <label>Verification timeout <span className="muted">(seconds)</span>
          <input required type="number" min={1} max={60} value={Number.isFinite(form.timeoutSeconds) ? form.timeoutSeconds : ''} onChange={(event) => update('timeoutSeconds', event.target.valueAsNumber)} />
          <small>Time allowed to collect item detections after a departure event.</small>
        </label>
        <div className="form-grid">
          <label>Time format<select value={form.timeFormat} onChange={(event) => update('timeFormat', event.target.value as Preferences['timeFormat'])}>
            <option value="12h">12-hour</option><option value="24h">24-hour</option>
          </select></label>
          <label>Date format<select value={form.dateFormat} onChange={(event) => update('dateFormat', event.target.value as Preferences['dateFormat'])}>
            <option value="short">Nov 21, 2026</option><option value="day-first">21 Nov 2026</option><option value="iso">2026-11-21</option>
          </select></label>
        </div>
        <Switch label="Browser notifications" description="Show a system notification for new missing-item alerts when supported." checked={form.browserNotifications} onChange={(checked) => {
          if (!checked) { setPermission(''); update('browserNotifications', false); return; }
          if (!('Notification' in window)) { setPermission('Browser notifications are unavailable on this device.'); return; }
          void Notification.requestPermission().then((status) => {
            update('browserNotifications', status === 'granted');
            setPermission(status === 'granted' ? '' : 'Enable notifications in your browser to use this setting.');
          }).catch(() => setPermission('This browser could not request notification permission.'));
        }} />
        {permission && <p className="muted" role="status">{permission}</p>}
      </>}
      {tab === 'Voice alerts' && <>
        <Switch label="Enable voice alerts" description="Announce all missing belongings in one message." checked={form.voiceEnabled} onChange={(checked) => update('voiceEnabled', checked)} />
        <label>Voice<select disabled={!voice.voices.length} value={form.voiceSelection} onChange={(event) => update('voiceSelection', event.target.value)}>
          <option value="">Browser default</option>{voice.voices.map((entry) => <option key={entry.voiceURI} value={entry.voiceURI}>{entry.name} ({entry.lang})</option>)}
        </select></label>
        <div className="form-grid">
          <label>Speech rate · {form.speechRate.toFixed(1)}×<input type="range" min=".5" max="2" step=".1" value={form.speechRate} onChange={(event) => update('speechRate', +event.target.value)} /></label>
          <label>Volume · {Math.round(form.voiceVolume * 100)}%<input type="range" min="0" max="1" step=".05" value={form.voiceVolume} onChange={(event) => update('voiceVolume', +event.target.value)} /></label>
        </div>
        <Switch label="Repeat until acknowledged" description="Acknowledge & stop ends playback for that alert and keeps its history." checked={form.repeatVoice} onChange={(checked) => update('repeatVoice', checked)} />
        <div className="settings-note"><Volume2 size={18} /><span>{voice.supported ? 'Keep LeaveMate open and audio enabled. Some browsers require an audio test before playback.' : 'This browser does not support speech synthesis. In-app alerts are still available.'}</span></div>
        {voice.error && <p className="muted" role="status">{voice.error}</p>}
        <button type="button" className="button button-white align-start" disabled={!voice.supported || voice.previewing} onClick={() => voice.preview(form)}><Volume2 size={16} /> {voice.previewing ? 'Playing preview…' : 'Test voice'}</button>
      </>}
      {tab === 'Device' && <>
        <div className="settings-note"><Cable size={19} /><span>ESP32 integration uses the generic device gateway when the hardware and detection provider are ready.</span></div>
        <dl className="system-rows detailed">
          <div><dt>ESP32 / device status</dt><dd>{state.device?.connected ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Device identifier</dt><dd className="breakable">{state.device?.identifier ?? '—'}</dd></div>
          <div><dt>Last communication</dt><dd>{state.device ? dateTime(state.device.lastCommunication, state.settings) : '—'}</dd></div>
          <div><dt>Hardware integration</dt><dd>{state.device ? 'Generic gateway' : 'Awaiting integration'}</dd></div>
        </dl>
      </>}
      {tab === 'System' && <>
        <Switch label="Simulation mode" description="Enable test departures from the verification page." checked={form.simulationMode} onChange={(checked) => update('simulationMode', checked)} />
        <dl className="system-rows detailed">
          <div><dt>Current mode</dt><dd><ModeTag state={state} /></dd></div>
          <div><dt>Application version</dt><dd>{state.backend.version}</dd></div>
          <div><dt>Database connectivity</dt><dd><span className="status-dot green" />{state.backend.database === 'supabase' ? 'Supabase PostgreSQL' : 'Local PostgreSQL'}</dd></div>
          <div><dt>System health</dt><dd>Operational</dd></div>
        </dl>
      </>}
      {(!Number.isFinite(form.timeoutSeconds) || form.timeoutSeconds < 1 || form.timeoutSeconds > 60) &&
        <div className="inline-alert"><CircleAlert size={16} /> Set a timeout from 1 to 60 seconds in General.</div>}
      <footer className="dialog-footer"><button type="button" className="button button-white" onClick={close} disabled={busy}>Close</button>
        <button className="button button-gold" type="submit" disabled={busy || !Number.isInteger(form.timeoutSeconds) || form.timeoutSeconds < 1 || form.timeoutSeconds > 60}>{busy ? 'Saving…' : 'Save settings'}</button></footer>
    </form>
  </Dialog>;
}
