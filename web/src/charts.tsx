import { Activity, ChartNoAxesCombined, ChartPie, ListFilter } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Session } from '../../shared/contracts';
import { daily, metrics } from './lib';
import { Empty, Panel } from './ui';

const colors = ['#e5bd43', '#c95e55'];

export function Trend({ sessions, alerts = false }: { sessions: Session[]; alerts?: boolean }) {
  const points = daily(sessions);
  if (!points.length || (alerts && !points.some((point) => point.alerts))) return <Empty icon={Activity} title={alerts ? 'No alerts in this period' : 'No verification activity'}>Activity appears here after a departure is verified.</Empty>;
  const areaColor = alerts ? '#c95e55' : '#a98828';
  return <div className="chart-parent">
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={points} margin={{ top: 12, right: 13, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e9e6dd" strokeDasharray="4 5" />
        <XAxis dataKey="day" minTickGap={28} tick={{ fill: '#77736a', fontSize: 12 }} tickLine={false} axisLine={false}
          tickFormatter={(day: string) => new Date(day + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })} />
        <YAxis allowDecimals={false} tick={{ fill: '#77736a', fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip labelFormatter={(day) => String(day)} contentStyle={{ borderRadius: 12, border: '1px solid #e9e6dd' }} />
        <Area type="monotone" dataKey={alerts ? 'alerts' : 'checks'} name={alerts ? 'Alerts' : 'Verifications'}
          stroke={areaColor} fill={areaColor} fillOpacity={0.14} strokeWidth={2}
          dot={points.length === 1 ? { r: 5 } : false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export function Distribution({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <Empty icon={ChartPie} title="No records to compare">This chart updates as matching records are saved.</Empty>;
  return <div className="distribution">
    <div className="donut"><ResponsiveContainer width="100%" height={156}>
      <PieChart><Pie data={data} dataKey="value" innerRadius={48} outerRadius={67} paddingAngle={data.every((entry) => entry.value) ? 4 : 0}
        stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
        {data.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}
      </Pie><Tooltip /></PieChart>
    </ResponsiveContainer><div className="donut-total"><strong>{total}</strong><span>Total</span></div></div>
    <div className="legend">{data.map((entry, index) => <div key={entry.name}><i style={{ background: colors[index] }} /><span>{entry.name}</span><strong>{entry.value}</strong></div>)}</div>
  </div>;
}

export function Frequency({ sessions }: { sessions: Session[] }) {
  const { frequent } = metrics(sessions);
  if (!frequent.length) return <Empty icon={ListFilter} title="No missing items recorded">Missed belongings will be ranked here.</Empty>;
  const ranked = frequent.slice(0, 6);
  const description = ranked.map((row) => `${row.name}, ${row.count} ${row.count === 1 ? 'miss' : 'misses'}`).join('; ');
  return <div role="img" aria-label={description}>
    <ResponsiveContainer width="100%" height={Math.max(135, 34 * ranked.length + 25)}>
      <BarChart data={ranked} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fill: '#77736a', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis dataKey="name" type="category" width={90} tick={{ fill: '#625e53', fontSize: 12 }}
          tickFormatter={(name: string) => name.length > 13 ? name.slice(0, 12) + '…' : name} axisLine={false} tickLine={false} />
        <Tooltip />
        <Bar dataKey="count" name="Misses" fill="#e5bd43" radius={[0, 5, 5, 0]} barSize={13} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function VerificationCharts({ sessions, extended = false }: { sessions: Session[]; extended?: boolean }) {
  const result = metrics(sessions);
  return <div className="charts-grid">
    <Panel title="Daily verification activity" description="Completed departures by day" action={<ChartNoAxesCombined size={18} className="muted" />}><Trend sessions={sessions} /></Panel>
    <Panel title="Verification outcomes" description="Successful and incomplete departures">
      <Distribution data={[{ name: 'Successful', value: result.successful }, { name: 'Incomplete', value: result.incomplete }]} />
    </Panel>
    <Panel title="Frequently missed items" description="Belongings with the most misses"><Frequency sessions={sessions} /></Panel>
    {extended && <>
      <Panel title="Alert frequency" description="Missing-item alerts by day"><Trend sessions={sessions} alerts /></Panel>
      <Panel title="Missing-item priority" description="Essential and optional belongings">
        <Distribution data={[{ name: 'Essential', value: result.essential }, { name: 'Optional', value: result.optional }]} />
      </Panel>
    </>}
  </div>;
}
