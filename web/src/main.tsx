import '@fontsource-variable/dm-sans';
import './style.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import {
  Bell, ChartNoAxesCombined, Check, CircleAlert, House, LoaderCircle, Package,
  ScanLine, Settings2, UserRound, Volume2, X, type LucideIcon,
} from 'lucide-react';
import type { DetectionProgress, Item, ServerEvents, Snapshot } from '../../shared/contracts';
import { Alerts, AlertDetails, type AlertTab } from './Alerts';
import { Analytics } from './Analytics';
import { Detection } from './Detection';
import { ItemEditor, Items } from './Items';
import { api, apiUrl, dateTime, type Action } from './lib';
import { Overview, type Page } from './Overview';
import { UsbStationProvider } from './usbStation';
import { Settings } from './Settings';
import { ActionError, BrandMark, Empty } from './ui';
import { sendBrowserNotification, useVoice } from './voice';

const pages: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: House },
  { id: 'items', label: 'Item Management', icon: Package },
  { id: 'detection', label: 'Detection & Verification', icon: ScanLine },
  { id: 'alerts', label: 'Alerts & History', icon: Bell },
  { id: 'analytics', label: 'Analytics & Reports', icon: ChartNoAxesCombined },
];

function currentPage(): Page {
  return pages.find((page) => page.id === location.hash.slice(1).split('/')[0])?.id ?? 'overview';
}

function App() {
  const [page, setPage] = useState(currentPage);
  const [alertTab, setAlertTab] = useState<AlertTab>(location.hash === '#alerts/history' ? 'history' : 'alerts');
  const [state, setState] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState<'loading' | 'offline' | 'ready'>('loading');
  const [live, setLive] = useState(false);
  const [progress, setProgress] = useState<DetectionProgress | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [popup, setPopup] = useState<'notifications' | 'profile' | null>(null);
  const [editor, setEditor] = useState<{ item: Item | null } | null>(null);
  const [settings, setSettings] = useState(false);
  const [alertDetails, setAlertDetails] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean; formError: boolean } | null>(null);
  const ticket = useRef(0);
  const progressVersion = useRef(0);
  const lastFinished = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const statusRef = useRef(state);
  statusRef.current = state;
  const navRef = useRef<HTMLDivElement>(null);
  const voice = useVoice(state?.alerts ?? [], state?.settings);
  const unread = state?.alerts.filter((alert) => !alert.isRead).length ?? 0;
  const selectedAlert = state?.alerts.find((alert) => alert.id === alertDetails);

  useEffect(() => {
    function syncPage() {
      setPage(currentPage());
      setAlertTab(location.hash === '#alerts/history' ? 'history' : 'alerts');
      setPopup(null);
    }
    function dismiss(event: MouseEvent) {
      if (!navRef.current?.contains(event.target as Node)) setPopup(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPopup(null);
    }
    window.addEventListener('hashchange', syncPage);
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('hashchange', syncPage);
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const alertUser = useCallback((message: string, error = false, formError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error, formError });
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 7000 : 3600);
  }, []);

  const refresh = useCallback(async () => {
    const id = ++ticket.current;
    try {
      const data = await api<Snapshot>('/state');
      if (ticket.current === id) {
        setState(data);
        setConnection('ready');
      }
      return data;
    } catch {
      if (ticket.current === id) setConnection('offline');
    }
  }, []);

  async function syncDetection() {
    const version = progressVersion.current;
    const data = await api<{ progress: DetectionProgress | null; error: string | null }>('/detection').catch(() => null);
    if (data && version === progressVersion.current) {
      setProgress(data.progress);
      setDetectionError(data.error);
    }
  }

  useEffect(() => {
    let disposed = false;
    let socket: Socket<ServerEvents> | undefined;
    const recheck = () => { void refresh(); void syncDetection(); };
    function connect() {
      if (socket || disposed) return;
      socket = io(apiUrl || undefined);
      socket.on('connect', () => { setLive(true); recheck(); });
      socket.on('connect_error', () => setLive(false));
      socket.on('disconnect', () => setLive(false));
      socket.on('state_changed', () => void refresh());
      socket.on('device_status_updated', () => void refresh());
      const update = (value: DetectionProgress) => {
        progressVersion.current++;
        setDetectionError(null);
        setProgress(value);
      };
      socket.on('detection_started', update);
      socket.on('detection_updated', update);
      socket.on('verification_completed', (session) => {
        progressVersion.current++;
        lastFinished.current = session.id;
        setProgress(null);
        setDetectionError(null);
        if (!session.missing) alertUser('Departure verified. All belongings were detected.');
      });
      socket.on('verification_failed', ({ id, message }) => {
        progressVersion.current++;
        lastFinished.current = id;
        setProgress(null);
        setDetectionError(message);
        alertUser(message, true);
      });
      socket.on('alert_created', (alert) => {
        sendBrowserNotification(alert, statusRef.current?.settings.browserNotifications ?? false);
        alertUser(alert.items.length === 1 ? 'One belonging is missing.' : alert.items.length + ' belongings are missing.', true);
      });
      socket.on('alert_acknowledged', (id) => {
        ticket.current++;
        setState((prior) => prior && ({ ...prior, alerts: prior.alerts.map((alert) => alert.id === id
          ? { ...alert, acknowledgedAt: new Date().toISOString(), isRead: true } : alert) }));
      });
      void syncDetection();
    }
    const refreshAndConnect = () => void refresh().then((data) => { if (data) connect(); });
    refreshAndConnect();
    const timer = window.setInterval(() => { refreshAndConnect(); if (socket) void syncDetection(); }, 30_000);
    return () => {
      disposed = true;
      ticket.current++;
      clearInterval(timer);
      socket?.disconnect();
      setLive(false);
    };
  }, [revision, refresh, alertUser]);

  const act: Action = async (operation, message) => {
    try {
      const result = await operation();
      if (message) {
        await refresh();
        alertUser(message);
      }
      return result;
    } catch (error) {
      alertUser(error instanceof Error ? error.message : 'The operation failed.', true, true);
    }
  };

  function navigate(value: Page, tab: AlertTab = 'alerts') {
    setPage(value);
    setPopup(null);
    if (value === 'alerts') setAlertTab(tab);
    const target = '#' + value + (value === 'alerts' && tab === 'history' ? '/history' : '');
    if (location.hash !== target) window.location.hash = target;
    if (page !== value) window.scrollTo({ top: 0 });
  }

  async function changeAlert(id: string, action: 'read' | 'acknowledge') {
    const saved = await act(async () => { await api('/alerts/' + id + '/' + action, 'POST'); return true; });
    if (!saved) return;
    if (action === 'acknowledge') {
      setState((prior) => prior && ({ ...prior, alerts: prior.alerts.map((alert) => alert.id === id
        ? { ...alert, acknowledgedAt: new Date().toISOString(), isRead: true } : alert) }));
      alertUser('Alert acknowledged.');
    }
    await refresh();
  }

  function retry() {
    setConnection('loading');
    setRevision((number) => number + 1);
  }

  return <ActionError.Provider value={toast?.formError ? toast.message : ''}>
    <header className="top-bar">
      <div className="top-inner">
        <a href="#overview" className="brand" onClick={(event) => { event.preventDefault(); navigate('overview'); }} aria-label="LeaveMate home"><BrandMark /><span>LeaveMate</span></a>
        <nav className="main-nav" aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined}
            onClick={(event) => { event.preventDefault(); navigate(id); }}><Icon size={16} strokeWidth={1.85} /><span>{label}</span></a>)}
        </nav>
        <div className="utility" ref={navRef}>
          <button className="icon-button utility-icon" disabled={!state} aria-label="Settings" onClick={() => { setPopup(null); setToast(null); setSettings(true); }}><Settings2 size={20} /></button>
          <button className="icon-button utility-icon bell-trigger" disabled={!state} aria-label={'Notifications, ' + unread + ' unread'} aria-expanded={popup === 'notifications'}
            onClick={() => setPopup((value) => value === 'notifications' ? null : 'notifications')}><Bell size={20} />
            {unread > 0 && <span className="unread-count">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button className="icon-button profile-trigger" disabled={!state} aria-label="Profile" aria-expanded={popup === 'profile'}
            onClick={() => setPopup((value) => value === 'profile' ? null : 'profile')}><UserRound size={18} /></button>
          {state && popup === 'notifications' && <section className="popover" aria-label="Notifications">
            <header><div><h2>Notifications</h2><p>{unread} unread</p></div>
              {unread > 0 && <button className="text-button" onClick={() => void act(() => api('/alerts/read-all', 'POST'), 'All notifications marked as read.')}>Mark all as read</button>}</header>
            {!state.alerts.length ? <Empty icon={Bell} title="You’re all caught up" /> : <div className="popover-list">
              {state.alerts.slice(0, 6).map((alert) => <button className="list-row row-button" key={alert.id} onClick={() => {
                setPopup(null); setToast(null); setAlertDetails(alert.id);
              }}><span className="list-icon list-icon-warning"><Bell size={16} /></span>
                <span className="grow min-w-0"><strong>{alert.items.map((item) => item.name).join(', ')}</strong><small>{dateTime(alert.createdAt, state.settings)}</small></span>
                {!alert.isRead && <span className="status-dot amber" aria-label="Unread" />}</button>)}
            </div>}
            <footer><button className="button button-white" onClick={() => navigate('alerts')}>Open alert centre</button></footer>
          </section>}
          {state && popup === 'profile' && <section className="popover profile-popover" aria-label="Profile information">
            <header><div><h2>LeaveMate workspace</h2><p>Single-user departure station</p></div></header>
            <footer><button className="button button-white" onClick={() => { setPopup(null); setSettings(true); }}>Preferences</button></footer>
          </section>}
        </div>
      </div>
    </header>

    <main className="workspace" aria-busy={connection === 'loading'}>
      {!state && connection === 'loading' && <div className="panel startup"><LoaderCircle className="spinner" size={29} /><strong>Connecting to LeaveMate…</strong></div>}
      {!state && connection === 'offline' && <div className="panel startup"><CircleAlert size={27} /><strong>LeaveMate is unavailable</strong><p>Check that the backend and database are running.</p><button className="button button-gold" onClick={retry}>Retry connection</button></div>}
      {state && <>
        {connection === 'offline' && <div className="inline-alert" role="status"><CircleAlert size={16} /> Connection lost. Showing last synced data. <button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
        {state.alerts.some((alert) => !alert.acknowledgedAt) && voice.supported && state.settings.voiceEnabled && !voice.ready && page !== 'alerts' &&
          <div className="voice-banner"><Volume2 size={17} /><span>{voice.error || 'Enable audio to hear open missing-item alerts.'}</span>
            <button className="text-button" disabled={voice.previewing} onClick={() => voice.preview(state.settings)}>{voice.previewing ? 'Testing audio…' : 'Enable audio'}</button></div>}
        {page === 'overview' && <Overview state={state} navigate={navigate} addItem={() => setEditor({ item: null })} showAlerts={() => navigate('alerts')} />}
        {page === 'items' && <Items state={state} act={act} add={() => setEditor({ item: null })} edit={(item) => setEditor({ item })} />}
        {page === 'detection' && <Detection state={state} progress={progress} error={detectionError} act={act}
          acceptProgress={(value) => {
            if (lastFinished.current === value.id) return;
            setDetectionError(null);
            setProgress((prior) => prior?.id === value.id ? prior : value);
          }} addItem={() => setEditor({ item: null })} />}
        {page === 'alerts' && <Alerts state={state} tab={alertTab} setTab={(tab) => navigate('alerts', tab)} change={changeAlert} showAlert={setAlertDetails} voice={voice} />}
        {page === 'analytics' && <Analytics state={state} />}
        {editor && <ItemEditor state={state} item={editor.item} act={act} onClose={() => { setEditor(null); setToast((value) => value?.error ? null : value); }} />}
        {settings && <Settings state={state} act={act} voice={voice} close={() => setSettings(false)} />}
        {selectedAlert && <AlertDetails alert={selectedAlert} state={state} change={changeAlert} onClose={() => setAlertDetails(null)} />}
        <footer className="workspace-footer"><span><BrandMark /> LeaveMate</span><span><i className={'status-dot ' + (live ? 'green' : '')} />{live ? 'Live updates connected' : 'Reconnecting live updates'}</span></footer>
      </>}
    </main>
    {toast && <div className={'toast ' + (toast.error ? 'toast-error' : '')} role="status">
      {toast.error ? <CircleAlert size={18} /> : <Check size={18} />}<span>{toast.message}</span>
      <button className="icon-button" aria-label="Dismiss message" onClick={() => setToast(null)}><X size={17} /></button>
    </div>}
  </ActionError.Provider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><UsbStationProvider><App /></UsbStationProvider></StrictMode>);
