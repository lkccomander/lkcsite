import { useEffect, useRef } from "react";
import { TapeItem } from "../types";

type TradeActionTone = "entry" | "exit";

function detectTradeAction(item: TapeItem): TradeActionTone | null {
  if (item.text.startsWith("ENTRY")) {
    return "entry";
  }
  if (item.text.startsWith("EXIT")) {
    return "exit";
  }
  return null;
}

function playTone(context: AudioContext, frequency: number, durationMs: number, volume: number): void {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const now = context.currentTime;
  const durationSeconds = durationMs / 1000;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(now);
  oscillator.stop(now + durationSeconds + 0.02);
}

function playTradeActionSound(context: AudioContext, tone: TradeActionTone): void {
  if (tone === "entry") {
    playTone(context, 784, 120, 0.035);
    playTone(context, 988, 180, 0.025);
    return;
  }

  playTone(context, 523.25, 90, 0.035);
  playTone(context, 392, 180, 0.03);
}

export function useTradeActionSound(items: TapeItem[]): void {
  const audioContextRef = useRef<AudioContext | null>(null);
  const knownEventIdsRef = useRef<Set<string>>(new Set());
  const hasPrimedRef = useRef(false);

  useEffect(() => {
    const AudioContextCtor = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

    if (!AudioContextCtor || audioContextRef.current) {
      return;
    }

    const context = new AudioContextCtor();
    audioContextRef.current = context;

    const resumeAudio = () => {
      if (context.state === "suspended") {
        void context.resume();
      }
    };

    window.addEventListener("pointerdown", resumeAudio);
    window.addEventListener("keydown", resumeAudio);

    return () => {
      window.removeEventListener("pointerdown", resumeAudio);
      window.removeEventListener("keydown", resumeAudio);
      void context.close();
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tradeItems = items.filter((item) => detectTradeAction(item) !== null);
    const knownEventIds = knownEventIdsRef.current;

    if (!hasPrimedRef.current) {
      for (const item of tradeItems) {
        knownEventIds.add(item.id);
      }
      hasPrimedRef.current = true;
      return;
    }

    const newTradeItems = tradeItems.filter((item) => !knownEventIds.has(item.id)).reverse();

    for (const item of tradeItems) {
      knownEventIds.add(item.id);
    }

    const context = audioContextRef.current;
    if (!context || newTradeItems.length === 0) {
      return;
    }

    if (context.state === "suspended") {
      void context.resume();
    }

    for (const item of newTradeItems) {
      const tone = detectTradeAction(item);
      if (tone) {
        playTradeActionSound(context, tone);
      }
    }
  }, [items]);
}
