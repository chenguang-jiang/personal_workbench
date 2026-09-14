"use client";

import { useEffect, useRef } from "react";

const MAX_GAZE_DISTANCE = 6;
const BLINK_DURATION = 560;

type WorkspacePulseProps = {
  compact?: boolean;
  onBlinkComplete?: () => void;
};

export function WorkspacePulse({ compact = false, onBlinkComplete }: WorkspacePulseProps) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const blinkTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    function drawGaze() {
      frame = 0;
      if (!root || reducedMotion.matches) return;
      const irises = root.querySelectorAll<HTMLElement>("[data-gaze]");
      irises.forEach((iris) => {
        const eye = iris.closest<HTMLElement>("[data-eye]");
        if (!eye) return;
        const rect = eye.getBoundingClientRect();
        const deltaX = pointerX - (rect.left + rect.width / 2);
        const deltaY = pointerY - (rect.top + rect.height / 2);
        const distance = Math.hypot(deltaX, deltaY) || 1;
        const travel = Math.min(MAX_GAZE_DISTANCE, distance * 0.055);
        iris.style.setProperty("--gaze-x", `${(deltaX / distance) * travel}px`);
        iris.style.setProperty("--gaze-y", `${(deltaY / distance) * travel}px`);
      });
    }

    function scheduleGaze() {
      if (frame) return;
      frame = window.requestAnimationFrame(drawGaze);
    }

    function handlePointerMove(event: PointerEvent) {
      pointerX = event.clientX;
      pointerY = event.clientY;
      scheduleGaze();
    }

    function resetGaze() {
      root?.querySelectorAll<HTMLElement>("[data-gaze]").forEach((iris) => {
        iris.style.setProperty("--gaze-x", "0px");
        iris.style.setProperty("--gaze-y", "0px");
      });
    }

    function handlePointerOut(event: PointerEvent) {
      if (!event.relatedTarget) resetGaze();
    }

    function handleMotionPreference() {
      if (reducedMotion.matches) resetGaze();
      else scheduleGaze();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerout", handlePointerOut, { passive: true });
    window.addEventListener("blur", resetGaze);
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", resetGaze);
      reducedMotion.removeEventListener("change", handleMotionPreference);
      if (blinkTimerRef.current) window.clearTimeout(blinkTimerRef.current);
    };
  }, []);

  function blink() {
    const root = rootRef.current;
    if (!root) return;
    if (blinkTimerRef.current) window.clearTimeout(blinkTimerRef.current);
    root.classList.remove("workspace-pulse--blinking");
    void root.offsetWidth;
    root.classList.add("workspace-pulse--blinking");
    blinkTimerRef.current = window.setTimeout(() => {
      root.classList.remove("workspace-pulse--blinking");
      blinkTimerRef.current = null;
      onBlinkComplete?.();
    }, BLINK_DURATION);
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className={compact ? "workspace-pulse workspace-pulse--compact" : "workspace-pulse"}
      aria-label="AI 索引在线；眼睛会跟随指针，点击可以眨眼"
      title="点击眨眼"
      onClick={blink}
    >
      <span className="workspace-eye-shell" aria-hidden="true">
        <span className="workspace-eye-sensor workspace-eye-sensor--left" />
        <span className="workspace-eye-bridge" />
        <span className="workspace-eye" data-eye>
          <span className="workspace-eye__iris" data-gaze />
        </span>
        <span className="workspace-eye workspace-eye--right" data-eye>
          <span className="workspace-eye__iris" data-gaze />
        </span>
        <span className="workspace-eye-sensor workspace-eye-sensor--right" />
      </span>
      <span className="workspace-pulse-copy">
        <span className="status-dot" />
        <small>AI INDEX ONLINE</small>
      </span>
    </button>
  );
}
