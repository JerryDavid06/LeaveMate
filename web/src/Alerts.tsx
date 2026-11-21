import { useState } from 'react';
import { Bell, CheckCheck, ClipboardList, Download, Search, TriangleAlert, Volume2 } from 'lucide-react';
import type { Alert, Session, Snapshot } from '../../shared/contracts';
import { dateTime, dayKey, downloadCsv } from './lib';
import { Dialog, Empty, ItemImage, OutcomeTag, PageHeading, Panel, PriorityTag, SessionDetails } from './ui';
import type { VoiceControls } from './voice';

export type AlertTab = 'alerts' | 'history';
export type AlertAction = (id: string, action: 'read' | 'acknowledge') => Promise<void>;

export function AlertDetails({ alert, state, onClose, change }: { alert: Alert; state: Snapshot; onClose: () => void; change: AlertAction }) {
  return <Dialog title="Missing belongings" onClose={onClose} wide>
    <div className="detail-intro"><span className={`tag ${alert.priority === 'high' ? 'tag-danger' : 'tag-gold'}`}>{alert.priority === 'high' ? 'High priority' : 'Normal priority'}</span>
      <span className="tag tag-neutral">{alert.acknowledgedAt ? 'Acknowledged' : 'Awaiting acknowledgement'}</span></div>
    <p className="dialog-copy">{alert.message}</p><p className="muted">{dateTime(alert.createdAt, state.settings)}</p>
    <div className="list">{alert.items.map((item) => <div className="list-row" key={item.itemId}>
      <ItemImage image={item.image} category={item.category} /><div className="grow min-w-0"><strong>{item.name}</strong><small>{item.category}</small></div><PriorityTag priority={item.priority} />
    </div>)}</div>
    <div className="dialog-footer">
      {!alert.isRead && <button className="button button-white" onClick={() => void change(alert.id, 'read')}>Mark as read</button>}
      {!alert.acknowledgedAt && <button className="button button-gold" onClick={() => void change(alert.id, 'acknowledge')}><CheckCheck size={16} /> Acknowledge & stop</button>}
    </div>
  </Dialog>;
}

export function Alerts({ state, tab, setTab, change, showAlert, voice }: {
  state: Snapshot; tab: AlertTab; setTab: (tab: AlertTab) => void; change: AlertAction; showAlert: (id: string) => void; voice: VoiceControls;
}) {
  const [alertFilter, setAlertFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const selectedSession = state.sessions.find((session) => session.id === selected);
  const alerts = state.alerts.filter((alert) => alertFilter === 'all' || (alertFilter === 'open' ? !alert.acknowledgedAt : !alert.isRead));
  const filtered = state.sessions.filter((session) => {
    const date = dayKey(session.completedAt);
    return (!start || date >= start) && (!end || date <= end) && (!outcome || session.status === outcome)
      && `${session.id} ${session.source} ${session.results.map((item) => item.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  return <>
    <PageHeading label="WORKSPACE / ACTIVITY" title="Alerts & History" description="Review missing belongings and past departure checks.">
      {tab === 'history' && <button className="button button-gold" disabled={!filtered.length} onClick={() => downloadCsv('leavemate-verification-history', filtered)}><Download size={16} /> Export CSV</button>}
      {tab === 'alerts' && voice.supported && state.settings.voiceEnabled && !voice.ready &&
        <button className="button button-white" disabled={voice.previewing} onClick={() => voice.preview(state.settings)}><Volume2 size={16} /> {voice.previewing ? 'Testing audio…' : 'Enable audio'}</button>}
    </PageHeading>
    {tab === 'alerts' && voice.error && <div className="inline-alert" role="status"><TriangleAlert size={17} />{voice.error}</div>}
    <div className="segmented alert-tabs" aria-label="Activity views">
      <button aria-pressed={tab === 'alerts'} onClick={() => setTab('alerts')}><Bell size={16} /> Alerts</button>
      <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}><ClipboardList size={16} /> Verification History</button>
    </div>
    {tab === 'alerts' ? <Panel title="Alert centre" description="One alert per departure with missing items"
      action={<select aria-label="Filter alerts" value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}>
        <option value="all">All alerts</option><option value="open">Unacknowledged</option><option value="unread">Unread</option>
      </select>}>
      {!alerts.length ? <Empty icon={Bell} title={state.alerts.length ? 'No matching alerts' : 'No alerts yet'}>Completed departures with missing belongings appear here.</Empty>
        : <div className="alerts-list">{alerts.map((alert) => <article key={alert.id} className={`alert-card ${alert.priority === 'high' ? 'alert-card-high' : ''}`}>
          <span className="list-icon list-icon-warning"><TriangleAlert size={19} /></span>
          <div className="alert-card-main"><div className="alert-meta">
            <span className={`tag ${alert.priority === 'high' ? 'tag-danger' : 'tag-gold'}`}>{alert.priority === 'high' ? 'High priority' : 'Normal priority'}</span>
            {!alert.isRead && <span className="tag tag-neutral">Unread</span>}
            {alert.acknowledgedAt && <span className="tag tag-success">Acknowledged</span>}
          </div><h3>{alert.items.map((item) => item.name).join(', ')}</h3>
            <p>{dateTime(alert.createdAt, state.settings)}</p>
            <div className="alert-item-priorities">{alert.items.map((item) => <span key={item.itemId}>{item.name} <PriorityTag priority={item.priority} /></span>)}</div>
          </div>
          <div className="alert-actions">
            <button className="button button-white" onClick={() => showAlert(alert.id)}>Details</button>
            {!alert.acknowledgedAt && <button className="button button-gold" onClick={() => void change(alert.id, 'acknowledge')}><CheckCheck size={16} /> Acknowledge & stop</button>}
          </div>
        </article>)}</div>}
    </Panel> : <Panel title="Verification history" description="Completed departures and their outcomes">
      <div className="filter-bar history-filters">
        <label className="search-box"><Search size={16} /><input aria-label="Search verification history" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search session ID or item…" /></label>
        <label className="date-filter">From<input aria-label="History start date" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="date-filter">To<input aria-label="History end date" type="date" min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <select aria-label="Filter by verification outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="">All outcomes</option><option value="successful">Successful</option><option value="incomplete">Incomplete</option>
        </select>
      </div>
      {!filtered.length ? <Empty icon={ClipboardList} title={state.sessions.length ? 'No matching verifications' : 'No verification history'}>
        {state.sessions.length ? 'Change your filters to see more results.' : 'Completed checks will appear here automatically.'}
      </Empty> : <HistoryTable rows={filtered} state={state} open={(session) => setSelected(session.id)} />}
    </Panel>}
    {selectedSession && <SessionDetails session={selectedSession} state={state} onClose={() => setSelected(null)} />}
  </>;
}

function HistoryTable({ rows, state, open }: { rows: Session[]; state: Snapshot; open: (session: Session) => void }) {
  return <table className="history-table">
    <thead><tr><th scope="col">Verification</th><th scope="col">Date and time</th><th scope="col">Expected</th><th scope="col">Detected</th><th scope="col">Missing</th><th scope="col">Outcome</th><th scope="col">Alert</th></tr></thead>
    <tbody>{rows.map((session) => <tr key={session.id}>
      <td data-label="Verification"><button className="title-button" onClick={() => open(session)} title={session.id}>{session.id.slice(0, 8)}</button><small>{session.source === 'simulation' ? 'Simulation' : 'Hardware'}</small></td>
      <td data-label="Date and time">{dateTime(session.completedAt, state.settings)}</td>
      <td data-label="Expected">{session.expected}</td><td data-label="Detected">{session.detected}</td><td data-label="Missing">{session.missing}</td>
      <td data-label="Outcome"><OutcomeTag status={session.status} /></td>
      <td data-label="Alert">{session.alertId ? session.acknowledgedAt ? 'Acknowledged' : 'Open' : '—'}</td>
    </tr>)}</tbody>
  </table>;
}
