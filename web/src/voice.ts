import { useEffect, useRef, useState } from 'react';
import type { Alert, Settings } from '../../shared/contracts';

function configureSpeech(message: string, settings: Settings) {
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = settings.speechRate;
  utterance.volume = settings.voiceVolume;
  utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === settings.voiceSelection) ?? null;
  if (!utterance.voice) utterance.lang = 'en';
  return utterance;
}

export function useVoice(alerts: Alert[], settings?: Settings) {
  const supported = typeof window.speechSynthesis !== 'undefined';
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ready, setReady] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const heard = useRef(new Set<string>());
  const rotate = useRef<string | null>(null);
  const running = useRef<SpeechSynthesisUtterance | null>(null);
  const queue = alerts.filter((alert) => !alert.acknowledgedAt).slice().reverse();
  const ids = queue.map((alert) => alert.id).join(',');
  const current = useRef(queue);
  current.current = queue;

  useEffect(() => {
    if (!supported) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    const activate = (event: Event) => {
      if (!event.isTrusted) return;
      setReady(true);
      window.removeEventListener('pointerup', activate);
      window.removeEventListener('keydown', activate);
    };
    read();
    window.speechSynthesis.addEventListener('voiceschanged', read);
    window.addEventListener('pointerup', activate);
    window.addEventListener('keydown', activate);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', read);
      window.removeEventListener('pointerup', activate);
      window.removeEventListener('keydown', activate);
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !ready || previewing || !settings?.voiceEnabled || !ids) return;
    let timer: number | undefined;
    let cancelled = false;
    function next() {
      if (cancelled || !settings) return;
      const pending = current.current;
      const unplayed = pending.find((alert) => !heard.current.has(alert.id));
      const lastIndex = pending.findIndex((alert) => alert.id === rotate.current);
      const alert = unplayed ?? (settings.repeatVoice ? pending[(lastIndex + 1) % pending.length] : undefined);
      if (!alert) return;
      const utterance = configureSpeech(alert.message, settings);
      running.current = utterance;
      utterance.onend = () => {
        if (cancelled) return;
        running.current = null;
        heard.current.add(alert.id);
        rotate.current = alert.id;
        timer = window.setTimeout(next, 3800);
      };
      utterance.onerror = (event) => {
        if (cancelled || event.error === 'canceled' || event.error === 'interrupted') return;
        running.current = null;
        setError('Browser speech is unavailable. Use Enable audio to retry.');
        setReady(false);
      };
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        setError('Browser speech is unavailable. Use Enable audio to retry.');
        setReady(false);
      }
    }
    timer = window.setTimeout(next, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (running.current) {
        const active = running.current;
        running.current = null;
        active.onend = null;
        active.onerror = null;
        window.speechSynthesis.cancel();
      }
    };
  }, [ids, supported, ready, previewing, settings?.voiceEnabled, settings?.voiceSelection, settings?.speechRate,
    settings?.voiceVolume, settings?.repeatVoice]);

  function preview(config: Settings) {
    if (!supported) return;
    if (running.current) {
      running.current.onend = null;
      running.current.onerror = null;
      running.current = null;
    }
    window.speechSynthesis.cancel();
    setPreviewing(true);
    setError('');
    const utterance = configureSpeech('LeaveMate voice alerts are ready.', config);
    utterance.onend = () => { setReady(true); setPreviewing(false); };
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      setError('Speech did not play. Check your browser and audio output.');
      setPreviewing(false);
      setReady(false);
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      setError('Speech did not play. Check your browser and audio output.');
      setPreviewing(false);
      setReady(false);
    }
  }

  return { voices, supported, ready, previewing, error, preview };
}

export type VoiceControls = ReturnType<typeof useVoice>;

export function sendBrowserNotification(alert: Alert, enabled: boolean) {
  if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('LeaveMate · Missing belongings', { body: alert.message, tag: alert.id }); } catch { /* In-app alerts remain available. */ }
}
