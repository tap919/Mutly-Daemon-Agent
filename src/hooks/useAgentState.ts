import { useState, useEffect, useCallback } from "react";
import type { FullState } from "../types";

interface UseAgentStateResult {
  data: FullState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAgentState(refreshIntervalMs = 30000): UseAgentStateResult {
  const [data, setData] = useState<FullState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    if (refreshIntervalMs > 0) {
      const interval = setInterval(fetchState, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchState, refreshIntervalMs]);

  return { data, loading, error, refetch: fetchState };
}
