import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { networkDiagnostics } from '@/common/services/NetworkDiagnosticsService';

/**
 * Mount once near the root (inside the router). Keeps the diagnostics
 * service's "current screen" tag accurate so every network call is
 * attributed to the route that triggered it.
 */
export function DiagnosticsScreenTracker() {
  const segments = useSegments();
  useEffect(() => {
    const name = segments.length ? segments.join('/') : 'unknown';
    networkDiagnostics.setScreen(name);
  }, [segments]);
  return null;
}
