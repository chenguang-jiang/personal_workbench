"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const REACTION_DURATION = 820;

const HEARTS = [
  { x: -34, y: -56, delay: 0, scale: 0.85 },
  { x: -13, y: -72, delay: 65, scale: 0.62 },
  { x: 10, y: -66, delay: 25, scale: 1 },
  { x: 31, y: -52, delay: 110, scale: 0.72 },
  { x: 42, y: -30, delay: 175, scale: 0.48 },
] as const;

type HeartStyle = CSSProperties & {
  "--heart-x": string;
  "--heart-y": string;
  "--heart-delay": string;
  "--heart-scale": number;
};

export function SpiderCompanion() {
  const rootRef = useRef<HTMLButtonElement>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let currentAngle = 0;
    let targetAngle = 0;
    let angularVelocity = 0;
    let lastFrameTime = performance.now();

    function drawSway(timestamp: number) {
      frame = 0;
      if (!root || reducedMotion.matches) return;
      const elapsed = Math.min((timestamp - lastFrameTime) / 1000, 1 / 30);
      const smoothTime = 0.18;
      const omega = 2 / smoothTime;
      const step = omega * elapsed;
      const decay = 1 / (1 + step + 0.48 * step ** 2 + 0.235 * step ** 3);
      const change = currentAngle - targetAngle;
      const velocityStep = (angularVelocity + omega * change) * elapsed;

      angularVelocity = (angularVelocity - omega * velocityStep) * decay;
      currentAngle = targetAngle + (change + velocityStep) * decay;

      if (Math.abs(targetAngle - currentAngle) < 0.004 && Math.abs(angularVelocity) < 0.004) {
        currentAngle = targetAngle;
        angularVelocity = 0;
      }
      root.style.setProperty("--spider-angle", `${currentAngle.toFixed(3)}deg`);
      lastFrameTime = timestamp;

      if (currentAngle !== targetAngle || angularVelocity !== 0) {
        frame = window.requestAnimationFrame(drawSway);
      }
    }

    function scheduleSway() {
      if (frame) return;
      lastFrameTime = performance.now();
      frame = window.requestAnimationFrame(drawSway);
    }

    function handlePointerMove(event: PointerEvent) {
      const viewportPosition = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      targetAngle = -viewportPosition * 6.5;
      scheduleSway();
    }

    function resetSway() {
      targetAngle = 0;
      scheduleSway();
    }

    function handlePointerOut(event: PointerEvent) {
      if (!event.relatedTarget) resetSway();
    }

    function disableSway() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      currentAngle = 0;
      targetAngle = 0;
      angularVelocity = 0;
      root?.style.setProperty("--spider-angle", "0deg");
    }

    function handleMotionPreference() {
      if (reducedMotion.matches) disableSway();
      else scheduleSway();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerout", handlePointerOut, { passive: true });
    window.addEventListener("blur", resetSway);
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", resetSway);
      reducedMotion.removeEventListener("change", handleMotionPreference);
    };
  }, []);

  function celebrate() {
    const root = rootRef.current;
    if (!root) return;
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    root.classList.remove("spider-companion--reacting");
    void root.offsetWidth;
    root.classList.add("spider-companion--reacting");
    setBurst((value) => value + 1);
    reactionTimerRef.current = window.setTimeout(() => {
      root.classList.remove("spider-companion--reacting");
      reactionTimerRef.current = null;
    }, REACTION_DURATION);
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className="spider-companion"
      aria-label="晨光小蜘蛛，点击发射爱心"
      title="点我发射爱心"
      onClick={celebrate}
    >
      <span className="spider-companion__rig" aria-hidden="true">
        <span className="spider-companion__thread" />
        <span className="spider-companion__drop">
          <span className="spider-companion__sway">
            <span className="spider-companion__body">
            <svg viewBox="0 0 140 160" role="presentation">
              <defs>
                <linearGradient id="spider-suit" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ff5965" />
                  <stop offset="0.48" stopColor="#e41f3a" />
                  <stop offset="1" stopColor="#a80624" />
                </linearGradient>
                <linearGradient id="spider-blue" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#174d79" />
                  <stop offset="1" stopColor="#0b2948" />
                </linearGradient>
                <radialGradient id="spider-eye" cx="45%" cy="32%" r="70%">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#dcecff" />
                </radialGradient>
              </defs>

              <path className="spider-companion__inner-thread" d="M70 -10V17" />

              <path className="spider-companion__folded-leg" d="M69 53C57 48 44 50 37 43C29 35 33 24 43 20C54 16 64 21 72 33L76 50Z" />
              <path className="spider-companion__folded-leg" d="M75 52C86 47 99 48 105 40C112 31 106 21 96 18C85 15 76 21 70 34L68 50Z" />

              <path d="M57 18C64 12 77 12 84 18L90 55C82 64 59 65 50 57Z" fill="url(#spider-suit)" stroke="#151526" strokeWidth="4.5" />
              <path d="M53 39C62 44 79 45 88 39L90 55C82 64 59 65 50 57Z" fill="url(#spider-blue)" opacity="0.95" />
              <path d="M70 15V61M58 23L86 43M82 19L55 45" className="spider-companion__web-mark" />

              <path className="spider-companion__arm" d="M62 35C57 29 57 21 62 13L66 7C68 4 73 5 75 8C77 11 76 14 73 16L71 18L69 36Z" />
              <path d="M65 12C68 14 71 14 74 12M62 21L70 24" className="spider-companion__web-mark" />

              <path d="M70 53C103 53 127 77 127 107C127 138 103 157 70 157C37 157 13 138 13 107C13 77 37 53 70 53Z" fill="url(#spider-suit)" stroke="#151526" strokeWidth="6" />
              <path d="M70 56V154M17 101H123M27 76C48 91 92 91 113 76M21 129C47 115 93 115 119 129" className="spider-companion__mask-web" />
              <path d="M69 57C49 70 40 86 37 103M71 57C91 70 100 86 103 103M37 103C43 128 54 143 70 154M103 103C97 128 86 143 70 154" className="spider-companion__mask-web" />
              <path d="M28 88C39 69 57 68 65 81C61 108 49 120 30 114C23 106 22 97 28 88Z" fill="url(#spider-eye)" stroke="#151526" strokeWidth="7" />
              <path d="M112 88C101 69 83 68 75 81C79 108 91 120 110 114C117 106 118 97 112 88Z" fill="url(#spider-eye)" stroke="#151526" strokeWidth="7" />
              <path d="M38 83C45 76 53 75 58 81" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.92" />
              <path d="M102 83C95 76 87 75 82 81" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.92" />
              <path className="spider-companion__arm" d="M87 43C99 44 107 54 109 65L112 77C111 83 104 84 100 79L97 65C96 58 91 53 84 51Z" />
              <path d="M96 53L106 61M99 61L109 68M101 70L111 75" className="spider-companion__web-mark" />
            </svg>
            </span>
          </span>
        </span>
      </span>
      {burst > 0 && (
        <span className="spider-companion__hearts" key={burst} aria-hidden="true">
          {HEARTS.map((heart, index) => (
            <span
              key={index}
              style={{
                "--heart-x": `${heart.x}px`,
                "--heart-y": `${heart.y}px`,
                "--heart-delay": `${heart.delay}ms`,
                "--heart-scale": heart.scale,
              } as HeartStyle}
            >
              ♥
            </span>
          ))}
        </span>
      )}
      <span className="spider-companion__hint" aria-hidden="true">HELLO, DAWN</span>
    </button>
  );
}
