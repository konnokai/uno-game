export type GameSound = "play-card" | "draw-card" | "wild-draw-four" | "uno" | "victory";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

function tone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  endFrequency = frequency,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.015, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** Shapes white noise into a short paper-like scrape instead of an electronic tone. */
function noise(
  context: AudioContext,
  start: number,
  duration: number,
  volume: number,
  frequency: number,
  filterType: BiquadFilterType,
): void {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.setValueAtTime(0.7, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.018, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
  source.stop(start + duration);
}

/** Layers a dry high scrape with a softer low rustle to resemble a card sliding on felt. */
function cardFriction(context: AudioContext, start: number, duration: number, volume: number): void {
  noise(context, start, duration, volume, 3_600, "bandpass");
  noise(context, start + 0.018, duration * 0.82, volume * 0.48, 1_250, "lowpass");
}

function playSynthesizedSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context) return;
  const start = context.currentTime + 0.01;

  switch (sound) {
    case "play-card":
      cardFriction(context, start, 0.13, 0.12);
      return;
    case "draw-card":
      cardFriction(context, start, 0.19, 0.1);
      return;
    case "wild-draw-four":
      cardFriction(context, start, 0.2, 0.14);
      return;
    case "uno":
      tone(context, 523.25, start, 0.12, 0.08, "triangle");
      tone(context, 659.25, start + 0.1, 0.12, 0.08, "triangle");
      tone(context, 783.99, start + 0.2, 0.2, 0.1, "triangle");
      return;
    case "victory":
      tone(context, 523.25, start, 0.16, 0.075, "triangle");
      tone(context, 659.25, start + 0.13, 0.16, 0.075, "triangle");
      tone(context, 783.99, start + 0.26, 0.16, 0.08, "triangle");
      tone(context, 1046.5, start + 0.4, 0.42, 0.1, "triangle");
      return;
  }
}

/** Unlocks browser audio after the first user gesture on the game page. */
export function unlockGameAudio(): void {
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

/** Plays the local synthesized version directly for the in-game sound preview. */
export function previewGameSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context) return;
  const play = () => playSynthesizedSound(sound);
  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
    return;
  }
  play();
}

/** Plays one short game sound; synthesized sounds work without bundled binary assets. */
export function playGameSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context) return;
  const play = () => playSynthesizedSound(sound);
  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
    return;
  }
  play();
}
