'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ApiClientError, isAbortError } from '@/lib/api';

export interface AsyncDataResult<T> {
  data: T | null;
  error: string | null;
  /** True only while the first payload is being fetched (safe for skeletons). */
  loading: boolean;
  /** True during any in-flight request, including polls and retries. */
  fetching: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
}

interface UseApiDataOptions {
  /** Poll interval in milliseconds; `null` disables polling. */
  pollMs?: number | null;
  enabled?: boolean;
}

/**
 * Small fetch-state hook: first-load / error / retry plus optional polling.
 * `loading` only covers the initial payload so background polls never flash a
 * skeleton or spin every refresh control on the page.
 */
export function useApiData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: UseApiDataOptions = {},
): AsyncDataResult<T> {
  const { pollMs = null, enabled = true } = options;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(enabled);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setFetching(false);
      return;
    }

    const controller = new AbortController();
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    setFetching(true);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive || isAbortError(cause)) return;
        setError(
          cause instanceof ApiClientError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'Something went wrong while loading this view.',
        );
      })
      .finally(() => {
        if (!alive) return;
        setFetching(false);
        if (pollMs != null && pollMs > 0) {
          timer = setTimeout(() => setTick((value) => value + 1), pollMs);
        }
      });

    return () => {
      alive = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // The caller declares its own dependency list for the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pollMs, tick, ...deps]);

  return { data, error, loading: fetching && data === null, fetching, reload, setData };
}
