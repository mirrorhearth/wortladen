let context: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

export function playTone(kind: "bell" | "card" | "wrong" | "coin" | "upgrade", enabled: boolean) {
  if (!enabled) return;
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  const notes = {
    bell: [740, 980],
    card: [260, 340],
    wrong: [180, 140],
    coin: [880, 1320],
    upgrade: [520, 660, 880],
  }[kind];
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = kind === "wrong" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.09, now + index * 0.06 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.06 + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + index * 0.06);
    oscillator.stop(now + index * 0.06 + 0.2);
  });
}

export function speakGerman(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

