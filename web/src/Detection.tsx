import { useEffect, useState } from 'react';
import { Check, CircleAlert, Clock3, FlaskConical, ListChecks, Play, ScanLine } from 'lucide-react';
import type { DetectionProgress, Snapshot } from '../../shared/contracts';
import { api, dateTime, type Action } from './lib';
import { Empty, ItemImage, Metric, ModeTag, PageHeading, Panel, PriorityTag } from './ui';

import { UsbStationPanel } from './UsbStationPanel';

export function Detection({ state, progress, error, act, acceptProgress, addItem }: {
  state: Snapshot; progress: DetectionProgress | null; error: string | null; act: Action;
  acceptProgress: (progress: DetectionProgress) => void; addItem: () => void;
}) {
  const monitored = state.items.filter((item) => item.monitoring);
  const latest = state.sessions[0];
  const [missing, setMissing] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(timer);
  }, [progress?.id]);
  const remaining = progress ? Math.max(0, Math.ceil((Date.parse(progress.deadline) - now) / 1000)) : 0;
  const snapshot = progress?.expected ?? latest?.results ?? monitored.map((item) => ({ ...item, itemId: item.id }));
  const detected = progress ? progress.detectedIds.length : latest?.detected;
  const caption = state.device?.connected ? 'Listening for automatic departure events.'
    : state.settings.simulationMode ? 'Simulation Mode — Waiting for hardware integration.' : 'Waiting for a hardware connection.';
  const available = state.settings.simulationMode && !sending && !progress && monitored.length > 0;
  return <>
    <PageHeading label="WORKSPACE / DEPARTURE STATION" title="Detection & Verification" description={caption}><ModeTag state={state} /></PageHeading>
    {error && <div role="alert" className="inline-alert"><CircleAlert size={18} />{error}</div>}
    <UsbStationPanel items={state.items} />
    <div className="metrics-grid detection-metrics">
      <Metric icon={ListChecks} title="Expected items" value={snapshot.length} note={progress ? 'In the current detection window' : latest ? 'In the latest completed check' : 'Currently enabled for monitoring'} tone="gold" />
      <Metric icon={Check} title="Detected items" value={detected ?? '—'} note={progress ? 'Reported so far' : 'In the latest completed check'} tone="green" />
      <Metric icon={CircleAlert} title="Missing items" value={progress ? '—' : latest?.missing ?? '—'} note={progress ? 'Calculated when the window closes' : 'In the latest completed check'} tone="coral" />
      <Metric icon={Clock3} title="Station status" value={progress ? remaining ? `${remaining}s` : 'Closing' : 'Ready'} note={progress ? 'Detection window in progress' : `${state.settings.timeoutSeconds}s detection window`} />
    </div>
    <div className="overview-columns verification-columns">
      <Panel title={progress ? 'Live verification' : 'Verification comparison'}
        description={progress ? (remaining ? 'Collecting detections before comparing belongings.' : 'Waiting for the provider to confirm completion.')
          : latest ? `Last detection · ${dateTime(latest.completedAt, state.settings)}` : 'Results appear when a detection window closes.'}
        action={(progress || latest) ? <span className="tag tag-neutral">{(progress?.source ?? latest?.source) === 'simulation' ? 'Simulation' : 'Hardware'}</span> : undefined}>
        {!snapshot.length ? <Empty icon={ScanLine} title="No belongings to verify" action={!state.items.length && <button className="button button-gold" onClick={addItem}>Add an item</button>}>
          Register a belonging and enable monitoring to run a check.
        </Empty> : <div className="list">
          {snapshot.map((item) => {
            const status = progress ? progress.detectedIds.includes(item.itemId) ? 'detected' : 'awaiting'
              : 'status' in item ? item.status : 'awaiting';
            return <div className="list-row" key={item.itemId}><ItemImage image={item.image} category={item.category} />
              <div className="grow min-w-0"><strong>{item.name}</strong><small>{item.category}</small></div><PriorityTag priority={item.priority} />
              <span className={`tag ${status === 'detected' ? 'tag-success' : status === 'missing' ? 'tag-danger' : 'tag-neutral'}`}>
                {status === 'detected' ? 'Detected' : status === 'missing' ? 'Missing' : 'Awaiting'}
              </span>
            </div>;
          })}
        </div>}
      </Panel>
      <Panel title="Simulate a departure" description="Test the workflow with simulated item detections." className="simulation-panel"
        action={<span className="tag tag-gold"><FlaskConical size={13} /> Test / Simulation</span>}>
        {!state.settings.simulationMode ? <Empty icon={FlaskConical} title="Simulation is disabled">Enable simulation in Settings to run a test.</Empty>
          : !monitored.length ? <Empty icon={ListChecks} title="No monitored items">Add a belonging or enable monitoring in Item Management.</Empty>
          : <>
            <div className="sim-options">
              <div className="sim-instructions">Select which belongings are detected.</div>
              {monitored.map((item) => <label key={item.id} className="sim-choice"><input type="checkbox" disabled={!!progress || sending} checked={!missing.includes(item.id)}
                onChange={(event) => setMissing((prior) => event.target.checked ? prior.filter((id) => id !== item.id) : [...prior, item.id])} />
                <span>{item.name}</span><PriorityTag priority={item.priority} /></label>)}
            </div>
            <button className="button button-gold" disabled={!available} onClick={async () => {
              setSending(true);
              const result = await act(() => api<DetectionProgress>('/simulation', 'POST', { detectedIds: monitored.filter((item) => !missing.includes(item.id)).map((item) => item.id) }));
              if (result) acceptProgress(result);
              setSending(false);
            }}><Play size={16} /> {progress ? 'Verification running' : 'Run test departure'}</button>
          </>}
      </Panel>
    </div>
  </>;
}
