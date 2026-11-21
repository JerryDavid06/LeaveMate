const timeline = [];
Object.assign(window, { speechTimeline: timeline });
let timer;
Object.defineProperty(window, 'speechSynthesis', {
  value: {
    getVoices: () => [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    cancel: () => window.clearTimeout(timer),
    speak: (utterance) => {
      timeline.push(utterance.text);
      timer = window.setTimeout(() => utterance.onend?.({}), 35);
    },
  },
});
