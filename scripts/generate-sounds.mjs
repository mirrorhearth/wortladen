import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SAMPLE_RATE = 44_100;
const OUTPUT_DIR = join(process.cwd(), "public", "assets", "audio");

function envelope(time, start, duration, attack = 0.008) {
  const local = time - start;
  if (local < 0 || local >= duration) return 0;
  if (local < attack) return local / attack;
  const progress = (local - attack) / Math.max(0.001, duration - attack);
  return Math.pow(1 - progress, 2.4);
}

function sine(time, frequency, phase = 0) {
  return Math.sin(Math.PI * 2 * frequency * time + phase);
}

function tone(time, { start = 0, duration, from, to = from, volume = 1, harmonics = [] }) {
  const level = envelope(time, start, duration);
  if (!level) return 0;
  const local = time - start;
  const progress = local / duration;
  const frequency = from + (to - from) * progress;
  let value = sine(local, frequency);
  harmonics.forEach(([multiple, amount]) => { value += sine(local, frequency * multiple) * amount; });
  return value * level * volume;
}

function makeWav(duration, render) {
  const sampleCount = Math.ceil(duration * SAMPLE_RATE);
  const samples = new Float64Array(sampleCount);
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = render(index / SAMPLE_RATE, index);
    samples[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  const scale = peak > 0 ? 0.78 / peak : 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const faded = index < 64
      ? index / 64
      : index > sampleCount - 65
        ? (sampleCount - 1 - index) / 64
        : 1;
    const sample = Math.max(-1, Math.min(1, samples[index] * scale * faded));
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return buffer;
}

let noiseSeed = 0x51f15e;
function noise() {
  noiseSeed = (noiseSeed * 1_664_525 + 1_013_904_223) >>> 0;
  return (noiseSeed / 0xffff_ffff) * 2 - 1;
}

const sounds = {
  "unlock.wav": makeWav(0.08, () => 0),
  "bell.wav": makeWav(0.58, (time) =>
    tone(time, { duration: 0.5, from: 740, volume: 0.8, harmonics: [[2, 0.38], [3, 0.16]] })
    + tone(time, { start: 0.12, duration: 0.44, from: 980, volume: 0.68, harmonics: [[2, 0.3]] })),
  "card.wav": makeWav(0.2, (time) => {
    const sweep = tone(time, { duration: 0.18, from: 280, to: 540, volume: 0.55, harmonics: [[2, 0.18]] });
    const rustle = noise() * envelope(time, 0.015, 0.13, 0.004) * 0.18;
    return sweep + rustle;
  }),
  "wrong.wav": makeWav(0.42, (time) =>
    tone(time, { duration: 0.4, from: 230, to: 138, volume: 0.82, harmonics: [[2, 0.24], [3, 0.08]] })),
  "coin.wav": makeWav(0.26, (time) =>
    tone(time, { duration: 0.22, from: 1_060, to: 1_120, volume: 0.7, harmonics: [[2, 0.45], [3, 0.16]] })
    + tone(time, { start: 0.065, duration: 0.17, from: 1_570, volume: 0.55, harmonics: [[2, 0.22]] })),
  "upgrade.wav": makeWav(0.78, (time) =>
    tone(time, { duration: 0.28, from: 523.25, volume: 0.62, harmonics: [[2, 0.18]] })
    + tone(time, { start: 0.18, duration: 0.3, from: 659.25, volume: 0.64, harmonics: [[2, 0.18]] })
    + tone(time, { start: 0.36, duration: 0.4, from: 783.99, volume: 0.7, harmonics: [[2, 0.22]] })),
};

await mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all(Object.entries(sounds).map(([filename, data]) => writeFile(join(OUTPUT_DIR, filename), data)));
console.log(`Generated ${Object.keys(sounds).length} WAV files in ${OUTPUT_DIR}`);
