import { lazy, Suspense, useState } from 'react';
import { Activity, Bell, CalendarDays, CheckCheck, CircleAlert, ClipboardCheck, FolderOpen, Package, Plus, Radio, ScanLine, ShieldCheck, Target } from 'lucide-react';
import type { Session, Snapshot } from '../../shared/contracts';
import { dateTime, metrics } from './lib';
import { Empty, ItemImage, LinkButton, Metric, ModeTag, OutcomeTag, PageHeading, Panel, PriorityTag, SessionDetails, SystemRows } from './ui';

export type Page = 'overview' | 'items' | 'detection' | 'alerts' | 'analytics';
const VerificationCharts = lazy(async () => ({ default: (await import('./charts')).VerificationCharts }));

export function Overview({ state, navigate, addItem, showAlerts }: {
  state: Snapshot; navigate: (page: Page) => void; addItem: () => void; showAlerts: () => void;
}) {
  const result = metrics(state.sessions);
  const [selected, setSelected] = useState<Session | null>(null);
  const monitored = state.items.filter((item) => item.monitoring).length;
  const last = state.sessions[0];
  return <>
    <PageHeading label="WORKSPACE / OVERVIEW" title="Welcome to LeaveMate" description="Your belongings, verified before you leave.">
      <span className="date-chip"><CalendarDays size={16} />{new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      <button className="button button-gold" onClick={addItem}><Plus size={17} /> Add item</button>
    </PageHeading>
    <div className="overview-hero">
      <section className="station">
        <div className="station-copy">
          <div className="station-label"><Radio size={15} /> DEPARTURE STATION</div>
          <h2>{last?.missing ? 'Belongings need attention.' : 'Ready for your next departure.'}</h2>
          <p>{last ? `Last verification ${dateTime(last.completedAt, state.settings)}.` : 'Register the belongings you want LeaveMate to check before you head out.'}</p>
          <button className="button station-button" onClick={() => navigate('detection')}><ScanLine size={16} /> Open verification</button>
        </div>
        <div className="station-art" aria-hidden="true">
          <i className="orbit orbit-outer" /><i className="orbit orbit-middle" /><i className="orbit orbit-inner" />
          <div className="scanner-tile"><ShieldCheck size={49} strokeWidth={1.15} /></div>
          <i className="orbit-node a" /><i className="orbit-node b" /><i className="orbit-node c" />
        </div>
      </section>
      <Panel title="System status" className="system-panel" action={<ModeTag state={state} />}>
        <SystemRows state={state} />
      </Panel>
    </div>

    <div className="metrics-grid">
      <Metric icon={Package} title="Registered items" value={state.items.length} note={`${monitored} actively monitored`} tone="gold" />
      <Metric icon={CheckCheck} title="Successful verifications" value={result.successful} note={`Of ${result.total} completed sessions`} tone="green" />
      <Metric icon={Bell} title="Missing-item alerts" value={state.alerts.length} note={`${state.alerts.filter((alert) => !alert.acknowledgedAt).length} awaiting acknowledgement`} tone="coral" />
      <Metric icon={Target} title="Verification success rate" value={result.rate === null ? '—' : `${result.rate}%`} note={result.total ? 'Across all completed sessions' : 'Available after your first check'} tone="neutral" />
    </div>

    <div className="overview-columns">
      <Panel title="Registered belongings" description="Items in your departure checklist" action={<LinkButton onClick={() => navigate('items')}>View items</LinkButton>}>
        {!state.items.length ? <Empty icon={FolderOpen} title="Your checklist is empty">
          Add your first belonging to start monitoring it.
        </Empty> : <div className="list">
          {state.items.slice(0, 5).map((item) => <div className="list-row" key={item.id}><ItemImage image={item.image} category={item.category} />
            <div className="grow min-w-0"><strong>{item.name}</strong><small>{item.category}</small></div>
            <PriorityTag priority={item.priority} /><span className="monitor-label"><span className={`status-dot ${item.monitoring ? 'green' : ''}`} />{item.monitoring ? 'Monitored' : 'Paused'}</span>
          </div>)}
        </div>}
      </Panel>
      <Panel title="Recent verification activity" description="Your latest departure checks" action={<Activity size={18} className="muted" />}>
        {!state.sessions.length ? <Empty icon={ClipboardCheck} title="No completed verifications">Run a simulation to see the complete departure workflow.</Empty> :
          <div className="list">{state.sessions.slice(0, 5).map((session) => <button className="list-row row-button" key={session.id} onClick={() => setSelected(session)}>
            <span className="list-icon"><ScanLine size={17} /></span>
            <span className="grow min-w-0"><strong>{session.detected} detected · {session.missing} missing</strong><small>{dateTime(session.completedAt, state.settings)} · {session.source === 'simulation' ? 'Test' : 'Hardware'}</small></span>
            <OutcomeTag status={session.status} />
          </button>)}</div>}
      </Panel>
    </div>

    <Panel title="Recent alerts" description="Missing belongings from recent departures" action={<LinkButton onClick={showAlerts}>All alerts</LinkButton>}>
      {!state.alerts.length ? <Empty icon={Bell} title="No missing-item alerts">Alerts appear when belongings are missing from a completed check.</Empty> :
        <div className="list">{state.alerts.slice(0, 4).map((alert) => <div className="list-row" key={alert.id}>
          <span className="list-icon list-icon-warning"><CircleAlert size={17} /></span>
          <div className="grow min-w-0"><strong>{alert.items.map((item) => item.name).join(', ')}</strong><small>{dateTime(alert.createdAt, state.settings)}</small></div>
          <span className={`tag ${alert.priority === 'high' ? 'tag-danger' : 'tag-gold'}`}>{alert.priority === 'high' ? 'High priority' : 'Normal priority'}</span>
          <span className="muted recent-alert-status">{alert.acknowledgedAt ? 'Acknowledged' : 'Open'}</span>
        </div>)}</div>}
    </Panel>
    <div className="section-heading"><h2>Verification statistics</h2><LinkButton onClick={() => navigate('analytics')}>Analytics</LinkButton></div>
    <Suspense fallback={<div className="panel muted">Loading verification charts…</div>}><VerificationCharts sessions={state.sessions} /></Suspense>
    {selected && <SessionDetails session={selected} state={state} onClose={() => setSelected(null)} />}
  </>;
}
