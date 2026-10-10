type AudioContextConstructor = new () => AudioContext;

type SafariAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: AudioContextConstructor;
};

type SoundKind = "bell" | "card" | "wrong" | "coin" | "upgrade";

const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
let context: AudioContext | null = null;
let outputPrimed = false;
let mediaPlayer: HTMLAudioElement | null = null;
let unlockPlayer: HTMLAudioElement | null = null;
let mediaUnlocked = false;

function soundUrl(name: SoundKind | "unlock") {
  return `${ASSET_BASE}/assets/audio/${name}.wav`;
}

function createAudioPlayer(source: string) {
  if (typeof Audio === "undefined") return null;
  const player = new Audio(source);
  player.preload = "auto";
  player.setAttribute("playsinline", "");
  return player;
}

function getMediaPlayer() {
  mediaPlayer ??= createAudioPlayer(soundUrl("bell"));
  return mediaPlayer;
}

function getUnlockPlayer() {
  unlockPlayer ??= createAudioPlayer(soundUrl("unlock"));
  return unlockPlayer;
}

function getContext() {
  if (typeof window === "undefined") return null;
  const audioWindow = window as SafariAudioWindow;
  const AudioContextClass = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!context || context.state === "closed") {
    context = new AudioContextClass();
    outputPrimed = false;
  }
  return context;
}

function primeOutput(audio: AudioContext) {
  if (outputPrimed) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.01);
  outputPrimed = true;
}

async function unlockSynthAudio() {
  const audio = getContext();
  if (!audio) return false;
  try {
    if (audio.state !== "running") await audio.resume();
    if (audio.state !== "running") return false;
    primeOutput(audio);
    return true;
  } catch {
    return false;
  }
}

async function unlockMediaAudio() {
  if (mediaUnlocked) return true;
  const player = getUnlockPlayer();
  if (!player) return false;
  try {
    player.currentTime = 0;
    await player.play();
    player.pause();
    player.currentTime = 0;
    mediaUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

export async function unlockAudio() {
  const [mediaReady, synthReady] = await Promise.all([unlockMediaAudio(), unlockSynthAudio()]);
  return mediaReady || synthReady;
}

function scheduleTone(audio: AudioContext, kind: SoundKind) {
  if (audio.state !== "running") return;
  const now = audio.currentTime + 0.01;
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
    gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.06 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.06 + 0.2);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + index * 0.06);
    oscillator.stop(now + index * 0.06 + 0.22);
  });
}

function playSynthTone(kind: SoundKind) {
  const audio = getContext();
  if (!audio) return;
  if (audio.state === "running") {
    scheduleTone(audio, kind);
    return;
  }
  void audio.resume().then(() => {
    primeOutput(audio);
    scheduleTone(audio, kind);
  }).catch(() => undefined);
}

export function playTone(kind: SoundKind, enabled: boolean) {
  if (!enabled) return;
  const player = getMediaPlayer();
  if (!player) {
    playSynthTone(kind);
    return;
  }
  try {
    player.pause();
    player.src = soundUrl(kind);
    player.currentTime = 0;
    player.volume = 0.9;
    void player.play().catch(() => playSynthTone(kind));
  } catch {
    playSynthTone(kind);
  }
}

export function speakGerman(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

