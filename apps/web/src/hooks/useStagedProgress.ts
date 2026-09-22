import { useCallback, useEffect, useRef, useState } from 'react';

export type StagedProgressStep = {
  id: string;
  label: string;
  detail?: string;
  /** 该阶段至少展示时长（毫秒） */
  minMs: number;
  /** 占总进度权重，合计应为 100 */
  weight: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useStagedProgress(steps: StagedProgressStep[], active: boolean) {
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!active) {
      runIdRef.current += 1;
      setStepIndex(0);
      setDone(false);
      setElapsedMs(0);
      setStepStartedAt(0);
      return;
    }

    const runId = ++runIdRef.current;
    const startedAt = Date.now();
    setStepIndex(0);
    setDone(false);
    setElapsedMs(0);
    setStepStartedAt(startedAt);

    const tick = window.setInterval(() => {
      if (runIdRef.current !== runId) return;
      setElapsedMs(Date.now() - startedAt);
    }, 200);

    void (async () => {
      for (let index = 0; index < steps.length - 1; index += 1) {
        await sleep(steps[index]?.minMs ?? 600);
        if (runIdRef.current !== runId) return;
        const nextIndex = index + 1;
        setStepIndex(nextIndex);
        setStepStartedAt(Date.now());
      }
    })();

    return () => {
      runIdRef.current += 1;
      window.clearInterval(tick);
    };
  }, [active, steps]);

  const complete = useCallback(() => {
    setStepIndex(Math.max(steps.length - 1, 0));
    setDone(true);
  }, [steps.length]);

  const completedWeight = steps.slice(0, stepIndex).reduce((sum, step) => sum + step.weight, 0);
  const current = steps[stepIndex];
  const currentWeight = current?.weight ?? 0;
  const stepElapsed = stepStartedAt > 0 ? Date.now() - stepStartedAt : elapsedMs;
  const stepMin = current?.minMs ?? 600;
  const withinStep = done ? 1 : Math.min(0.95, stepElapsed / stepMin);
  const rawPercent = completedWeight + currentWeight * withinStep;
  const percent = done ? 100 : Math.min(96, rawPercent);

  return {
    stepIndex,
    done,
    percent,
    elapsedMs,
    currentStep: current,
    complete,
  };
}
