import { useCallback, useRef, useState } from "react";

interface UseAsyncActionState<R> {
  busy: boolean;
  result?: R;
  error?: string;
}

/**
 * Incapsula il pattern busy/result/error per le azioni asincrone delle viste.
 * Sostituisce decine di useState duplicati in TodayView/RiskView/GrowthView/
 * ClientsView/DeliveryView.
 *
 * @example
 * const verify = useAsyncAction(onVerifyRepositories);
 * <Button onClick={() => void verify.run()} disabled={verify.busy}>…</Button>
 * {verify.error && <ActionBanner tone="danger" title={verify.error} />}
 */
export function useAsyncAction<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
) {
  const [state, setState] = useState<UseAsyncActionState<R>>({ busy: false });
  // Tenere il riferimento all'ultima fn evita re-render inutili quando il caller la ricrea.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    setState({ busy: true });
    try {
      const result = await fnRef.current(...args);
      setState({ busy: false, result });
      return result;
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => setState({ busy: false }), []);

  return { ...state, run, reset };
}

export type AsyncAction<Args extends unknown[], R> = ReturnType<typeof useAsyncAction<Args, R>>;
