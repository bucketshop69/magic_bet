import { useCallback, useEffect, useRef, useState } from "react";
import betOpenGameStartUrl from "../assets/bet_open_game_start.mp3";
import eatUrl from "../assets/eat.mp3";
import loseUrl from "../assets/lose.mp3";
import winUrl from "../assets/win.mp3";

export type RetroSfxName =
  | "bet_open"
  | "game_start"
  | "eat"
  | "win"
  | "lose"
  | "draw";

type SfxConfig = {
  url: string;
  volume: number;
};

const SFX_CONFIG: Record<RetroSfxName, SfxConfig> = {
  bet_open: { url: betOpenGameStartUrl, volume: 0.9 },
  game_start: { url: betOpenGameStartUrl, volume: 0.92 },
  eat: { url: eatUrl, volume: 0.95 },
  win: { url: winUrl, volume: 1.0 },
  lose: { url: loseUrl, volume: 1.0 },
  draw: { url: betOpenGameStartUrl, volume: 0.95 },
};

function uniqueSfxUrls() {
  return Array.from(new Set(Object.values(SFX_CONFIG).map((item) => item.url)));
}

export function useRetroSfx() {
  const unlockedRef = useRef(false);
  const poolRef = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  const primedRef = useRef(false);
  const mutedRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);

  const getAudio = useCallback((url: string) => {
    const pool = poolRef.current.get(url) ?? [];
    let audio = pool.find((item) => item.paused || item.ended) ?? null;

    if (!audio) {
      audio = new Audio(url);
      audio.preload = "auto";
      pool.push(audio);
      poolRef.current.set(url, pool);
    }

    return audio;
  }, []);

  const unlockAudio = useCallback(async () => {
    if (typeof window === "undefined") return false;
    unlockedRef.current = true;

    if (primedRef.current) return true;
    primedRef.current = true;

    for (const url of uniqueSfxUrls()) {
      const audio = getAudio(url);
      audio.volume = 0;
      audio.muted = true;
      try {
        await audio.play();
      } catch {
        // Keep going; we still mark unlocked and allow retries.
      }
      audio.pause();
      audio.currentTime = 0;
      audio.muted = mutedRef.current;
    }

    return true;
  }, [getAudio]);

  const setMuted = useCallback((nextMuted: boolean) => {
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    for (const pool of poolRef.current.values()) {
      for (const audio of pool) {
        audio.muted = nextMuted;
        if (nextMuted) {
          audio.pause();
          audio.currentTime = 0;
        }
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(!mutedRef.current);
  }, [setMuted]);

  useEffect(() => {
    const onGesture = () => {
      void unlockAudio();
    };

    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("touchstart", onGesture, { passive: true });
    window.addEventListener("click", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("click", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [unlockAudio]);

  const playSfx = useCallback(
    (name: RetroSfxName) => {
      if (typeof window === "undefined") return;
      if (!unlockedRef.current) return;
      if (mutedRef.current) return;

      const config = SFX_CONFIG[name];
      if (!config) return;

      const audio = getAudio(config.url);
      audio.volume = config.volume;
      audio.muted = false;
      audio.currentTime = 0;
      void audio.play().catch(() => null);
    },
    [getAudio]
  );

  return { playSfx, unlockAudio, isMuted, toggleMute, setMuted };
}
