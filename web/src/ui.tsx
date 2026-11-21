import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowUpRight, Box, BriefcaseBusiness, Cable, Check, ChevronRight, FileText, KeyRound, PackageOpen, ScanLine,
  TriangleAlert, X, type LucideIcon,
} from 'lucide-react';
import type { ImageKey, Priority, Session, Snapshot } from '../../shared/contracts';

export function BrandMark() {
  return <span className="brand-mark"><ScanLine size={21} strokeWidth={2.2} /></span>;
}

export function PageHeading({ label, title, description, children }: {
  label: string; title: string; description: string; children?: ReactNode;
}) {
  return <header className="page-heading">
    <div><div className="eyebrow">{label}</div><h1>{title}</h1><p>{description}</p></div>
    {children && <div className="heading-actions">{children}</div>}
  </header>;
}

export function Panel({ title, description, action, className = '', children }: {
  title: string; description?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return <section className={`panel ${className}`}>
    <header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>
    {children}
  </section>;
}

export function Empty({ icon: Icon = PackageOpen, title, children, action }: {
  icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return <div className="empty">
    <span className="empty-icon"><Icon size={22} strokeWidth={1.7} /></span>
    <strong>{title}</strong>{children && <p>{children}</p>}{action}
  </div>;
}

const icons = new Map<string, LucideIcon>([['Documents', FileText], ['Accessories', BriefcaseBusiness], ['Keys', KeyRound]]);

export function ItemImage({ image, category, large = false }: { image: ImageKey | null; category: string; large?: boolean }) {
  const Icon = icons.get(category) ?? Box;
  return <div className={`item-image ${large ? 'item-image-large' : ''}`}>
    {image ? <img src={`/items/${image}.webp`} alt="" /> : <Icon size={large ? 36 : 21} aria-hidden="true" />}
  </div>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={`tag ${priority === 'essential' ? 'tag-gold' : 'tag-neutral'}`}>
    {priority === 'essential' ? 'Essential' : 'Optional'}
  </span>;
}

export function OutcomeTag({ status }: { status: Session['status'] }) {
  return status === 'successful'
    ? <span className="tag tag-success"><Check size={13} /> Successful</span>
    : <span className="tag tag-danger"><TriangleAlert size={13} /> Incomplete</span>;
}

export function ModeTag({ state }: { state: Snapshot }) {
  const connected = state.device?.connected;
  const text = connected ? 'Hardware Connected' : state.settings.simulationMode ? 'Simulation Mode' : 'Hardware Not Connected';
  return <span className={`tag mode-tag ${connected ? 'tag-success' : 'tag-gold'}`}><span className="status-dot" />{text}</span>;
}

export const ActionError = createContext('');

export function Dialog({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(ActionError);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? 'dialog dialog-wide' : 'dialog'} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-content">
      <header className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></header>
      {error && <div className="inline-alert" role="alert"><TriangleAlert size={16} />{error}</div>}
      {children}
    </div>
  </dialog>;
}

export function Switch({ checked, onChange, label, description }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string;
}) {
  return <label className="switch-row">
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="switch-track" aria-hidden="true" />
  </label>;
}

export function Metric({ icon: Icon, title, value, note, tone = 'neutral' }: {
  icon: LucideIcon; title: string; value: string | number; note: string; tone?: string;
}) {
  return <article className="metric">
    <div className="metric-top"><span className={`metric-icon metric-${tone}`}><Icon size={19} strokeWidth={1.8} /></span><span>{title}</span></div>
    <div className="metric-value">{value}</div>
    <div className="metric-note">{note}</div>
  </article>;
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="text-button" onClick={onClick}>{children}<ChevronRight size={15} /></button>;
}

export function SystemRows({ state }: { state: Snapshot }) {
  return <dl className="system-rows">
    <div><dt><Check size={15} /> Application</dt><dd><span className="status-dot green" /> Operational</dd></div>
    <div><dt><Cable size={15} /> Hardware</dt><dd>{state.device?.connected ? 'Connected' : 'Not connected'}</dd></div>
    <div><dt><ScanLine size={15} /> Operating mode</dt><dd>{state.device?.connected ? 'Hardware' : state.settings.simulationMode ? 'Simulation' : 'Standby'}</dd></div>
  </dl>;
}

export function SessionDetails({ session, state, onClose }: { session: Session; state: Snapshot; onClose: () => void }) {
  return <Dialog title="Verification details" onClose={onClose} wide>
    <div className="detail-intro"><OutcomeTag status={session.status} /><span className="tag tag-neutral">{session.source === 'simulation' ? 'Simulation' : 'Hardware'}</span></div>
    <p className="muted breakable">Session {session.id}</p>
    <p className="muted">{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', hour12: state.settings.timeFormat === '12h' }).format(new Date(session.completedAt))}</p>
    <div className="list">
      {session.results.map((item) => <div className="list-row" key={item.itemId}>
        <ItemImage image={item.image} category={item.category} /><div className="grow min-w-0"><strong>{item.name}</strong><small>{item.category}</small></div>
        <PriorityTag priority={item.priority} /><span className={`tag ${item.status === 'detected' ? 'tag-success' : 'tag-danger'}`}>{item.status === 'detected' ? 'Detected' : 'Missing'}</span>
      </div>)}
    </div>
  </Dialog>;
}

export { ArrowUpRight };
