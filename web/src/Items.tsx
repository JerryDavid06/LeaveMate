import { useMemo, useState, type FormEvent } from 'react';
import { Box, Clock3, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { assignImage, categories, images, type ImageKey, type Item, type ItemInput, type Snapshot } from '../../shared/contracts';
import { api, dateTime, itemInput, type Action } from './lib';
import { Dialog, Empty, ItemImage, PageHeading, PriorityTag, Switch } from './ui';

const emptyItem: ItemInput = {
  name: '', category: categories[0], description: '', priority: 'essential', monitoring: true,
  identifier: null, imageOverride: null,
};

export function ItemEditor({ item, state, act, onClose }: { item: Item | null; state: Snapshot; act: Action; onClose: () => void }) {
  const [form, setForm] = useState<ItemInput>(item ? itemInput(item) : emptyItem);
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof ItemInput>(field: K, value: ItemInput[K]) => setForm((prior) => ({ ...prior, [field]: value }));
  const list = [...new Set([...categories, ...state.items.map((entry) => entry.category)])];
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await act(() => api<Item>(item ? `/items/${item.id}` : '/items', item ? 'PUT' : 'POST', {
      ...form, identifier: form.identifier?.trim() || null,
    }), item ? 'Belonging updated.' : 'Belonging added.');
    setBusy(false);
    if (result) onClose();
  }
  return <Dialog title={item ? 'Edit belonging' : 'Add a belonging'} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={save} className="form-stack">
      <label>Item name<input autoFocus required maxLength={100} placeholder="e.g. House keys" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
      <div className="form-grid">
        <label>Category<input required list="item-categories" maxLength={60} value={form.category} onChange={(event) => update('category', event.target.value)} />
          <datalist id="item-categories">{list.map((category) => <option key={category} value={category} />)}</datalist></label>
        <label>Priority<select value={form.priority} onChange={(event) => update('priority', event.target.value as ItemInput['priority'])}>
          <option value="essential">Essential</option><option value="optional">Optional</option>
        </select></label>
      </div>
      <label>Description <span className="muted">(optional)</span><textarea rows={2} maxLength={500} value={form.description} onChange={(event) => update('description', event.target.value)} /></label>
      <label>Detection identifier <span className="muted">(optional)</span>
        <input maxLength={120} value={form.identifier ?? ''} onChange={(event) => update('identifier', event.target.value)} placeholder="Add later when hardware is ready" />
      </label>
      <div className="image-picker"><ItemImage image={form.imageOverride ?? assignImage(form.name, form.category)} category={form.category} />
        <label>Item image<select value={form.imageOverride ?? ''} onChange={(event) => update('imageOverride', (event.target.value || null) as ImageKey | null)}>
          <option value="">Match automatically</option>{images.map((image) => <option value={image} key={image}>{image.replace('-', ' ')}</option>)}
        </select></label>
      </div>
      <Switch checked={form.monitoring} onChange={(checked) => update('monitoring', checked)} label="Enable monitoring" description="Include this item in departure verification." />
      <footer className="dialog-footer"><button type="button" className="button button-white" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-gold" type="submit" disabled={busy}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add belonging'}</button></footer>
    </form>
  </Dialog>;
}

export function Items({ state, act, add, edit }: { state: Snapshot; act: Action; add: () => void; edit: (item: Item) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [remove, setRemove] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const categoryOptions = useMemo(() => [...new Set([...categories, ...state.items.map((item) => item.category)])], [state.items]);
  const items = state.items.filter((item) =>
    (!category || item.category === category) && (!priority || item.priority === priority) &&
    `${item.name} ${item.description} ${item.category} ${item.identifier ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const item = state.items.find((entry) => entry.id === detail);
  const history = item ? state.sessions.flatMap((session) => session.results.filter((result) => result.itemId === item.id).map((result) => ({ session, result }))) : [];
  return <>
    <PageHeading label="WORKSPACE / BELONGINGS" title="Item Management" description="Manage the belongings you want LeaveMate to verify.">
      <button className="button button-gold" onClick={add}><Plus size={17} /> Add item</button>
    </PageHeading>
    <div className="filter-bar">
      <label className="search-box"><Search size={17} /><input aria-label="Search items" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search belongings…" /></label>
      <select aria-label="Category filter" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select>
      <select aria-label="Priority filter" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option><option value="essential">Essential</option><option value="optional">Optional</option></select>
      <span className="filter-count">{items.length} of {state.items.length} items</span>
    </div>
    {!items.length ? <section className="panel spacious"><Empty icon={Box} title={state.items.length ? 'No matching belongings' : 'Add your first belonging'}
      action={!state.items.length && <button className="button button-gold" onClick={add}><Plus size={16} /> Add item</button>}>
      {state.items.length ? 'Try another search or clear a filter.' : 'Choose a name, category and priority. LeaveMate will assign an image automatically.'}
    </Empty></section> : <div className="item-grid">{items.map((entry) => <article className="item-card" key={entry.id}>
      <button className="item-card-photo" onClick={() => setDetail(entry.id)} aria-label={`View ${entry.name} details`}>
        <ItemImage image={entry.image} category={entry.category} large /><PriorityTag priority={entry.priority} />
      </button>
      <div className="item-card-body"><div className="item-card-title"><div className="min-w-0"><button className="title-button" onClick={() => setDetail(entry.id)}>{entry.name}</button><p>{entry.category}</p></div>
        <button className="icon-button" onClick={() => edit(entry)} aria-label={`Edit ${entry.name}`}><Pencil size={16} /></button>
        <button className="icon-button danger-icon" onClick={() => setRemove(entry)} aria-label={`Delete ${entry.name}`}><Trash2 size={16} /></button></div>
        <Switch label={entry.monitoring ? 'Monitoring active' : 'Monitoring paused'} checked={entry.monitoring}
          onChange={(monitoring) => void act(() => api(`/items/${entry.id}`, 'PUT', { ...itemInput(entry), monitoring }), monitoring ? 'Monitoring enabled.' : 'Monitoring paused.')} />
      </div>
    </article>)}</div>}
    {item && <Dialog title={item.name} onClose={() => setDetail(null)} wide>
      <div className="item-info"><ItemImage image={item.image} category={item.category} large /><div className="min-w-0"><PriorityTag priority={item.priority} />
        <p>{item.category} · {item.monitoring ? 'Monitoring active' : 'Monitoring paused'}</p>
        {item.description && <p>{item.description}</p>}{item.identifier && <p className="breakable">Detection identifier · {item.identifier}</p>}
        <p className="muted breakable">Item ID · {item.id}</p></div></div>
      <h3 className="dialog-subtitle">Item verification history</h3>
      {!history.length ? <Empty icon={Clock3} title="No checks for this item yet" /> : <div className="list">{history.map(({ session, result }) => <div className="list-row" key={session.id}>
        <div className="grow min-w-0"><strong>{dateTime(session.completedAt, state.settings)}</strong><small>{session.source === 'simulation' ? 'Simulation' : 'Hardware'}</small></div>
        <span className={`tag ${result.status === 'detected' ? 'tag-success' : 'tag-danger'}`}>{result.status === 'detected' ? 'Detected' : 'Missing'}</span>
      </div>)}</div>}
    </Dialog>}
    {remove && <Dialog title="Delete belonging?" onClose={() => { if (!busy) setRemove(null); }}>
      <p className="dialog-copy">Delete <strong>{remove.name}</strong> from your checklist? Existing verification history will be kept.</p>
      <div className="dialog-footer">
        <button className="button button-white" disabled={busy} onClick={() => setRemove(null)}>Cancel</button>
        <button className="button button-danger" disabled={busy} onClick={async () => {
          setBusy(true);
          const deleted = await act(async () => { await api(`/items/${remove.id}`, 'DELETE'); return true; }, 'Belonging deleted.');
          setBusy(false);
          if (deleted) setRemove(null);
        }}>{busy ? 'Deleting…' : 'Delete belonging'}</button>
      </div>
    </Dialog>}
  </>;
}
