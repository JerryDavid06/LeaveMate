import { lazy, Suspense, useState } from 'react';
import { Activity, Bell, CalendarDays, CheckCheck, CircleAlert, Download, Percent } from 'lucide-react';
import type { Snapshot } from '../../shared/contracts';
import { dayKey, downloadCsv, metrics } from './lib';
import { Metric, PageHeading } from './ui';

type Period = 'today' | 'week' | 'custom';
const periods: [Period, string][] = [['today', 'Daily'], ['week', 'Weekly'], ['custom', 'Custom']];
const VerificationCharts = lazy(async () => ({ default: (await import('./charts')).VerificationCharts }));

export function Analytics({ state }: { state: Snapshot }) {
  const [period, setPeriod] = useState<Period>('week');
  const today = new Date();
  const week = new Date();
  week.setDate(today.getDate() - 6);
  const [startDate, setStartDate] = useState(dayKey(week));
  const [endDate, setEndDate] = useState(dayKey(today));
  const [source, setSource] = useState('');
  const start = period === 'today' ? dayKey(today) : period === 'week' ? dayKey(week) : startDate;
  const end = period === 'custom' ? endDate : dayKey(today);
  const sessions = state.sessions.filter((session) => {
    const day = dayKey(session.completedAt);
    return (!start || day >= start) && (!end || day <= end) && (!source || session.source === source);
  });
  const result = metrics(sessions);
  return <>
    <PageHeading label="WORKSPACE / INSIGHTS" title="Analytics & Reports" description="See how often departures succeed and which belongings you miss.">
      <button className="button button-gold" disabled={!sessions.length} onClick={() => downloadCsv(`leavemate-report-${period}`, sessions)}><Download size={16} /> Export CSV</button>
    </PageHeading>
    <div className="filter-bar report-filters">
      <div className="segmented" aria-label="Report period">{periods.map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>
      {period === 'custom' ? <>
        <label className="date-filter">From<input type="date" aria-label="Report start date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="date-filter">To<input type="date" aria-label="Report end date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      </> : <span className="date-chip"><CalendarDays size={16} />{period === 'today' ? 'Today' : 'Last 7 days'}</span>}
      <select value={source} aria-label="Report source" onChange={(event) => setSource(event.target.value)}>
        <option value="">All detection sources</option><option value="simulation">Simulation only</option><option value="hardware">Hardware only</option>
      </select>
    </div>
    <div className="metrics-grid analytics-metrics">
      <Metric icon={Activity} title="Total verifications" value={result.total} note="Completed sessions in this period" tone="gold" />
      <Metric icon={CheckCheck} title="Successful" value={result.successful} note="All monitored items detected" tone="green" />
      <Metric icon={CircleAlert} title="Incomplete" value={result.incomplete} note="At least one missing item" tone="coral" />
      <Metric icon={Percent} title="Success rate" value={result.rate === null ? '—' : `${result.rate}%`} note="Share of completed sessions" />
      <Metric icon={Bell} title="Total alerts" value={result.alerts} note="One per incomplete session" tone="gold" />
      <Metric icon={CircleAlert} title="Essential misses" value={result.essential} note="High-priority belongings" tone="coral" />
      <Metric icon={CircleAlert} title="Optional misses" value={result.optional} note="Normal-priority belongings" />
    </div>
    <Suspense fallback={<div className="panel muted">Loading report charts…</div>}><VerificationCharts sessions={sessions} extended /></Suspense>
  </>;
}
