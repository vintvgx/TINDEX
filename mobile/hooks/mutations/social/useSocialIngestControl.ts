import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';

interface IngestControlResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

async function callIngestEndpoint(action: 'start' | 'stop'): Promise<IngestControlResponse> {
  const res = await loggedFetch(`${RAILWAY_BASE_URL}/social-signals/${action}`, { method: 'POST' });
  const data: IngestControlResponse = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Failed to ${action} social signal ingest (${res.status})`);
  }
  return data;
}

export function useStartSocialIngest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callIngestEndpoint('start'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-ingest-status'] }),
  });
}

export function useStopSocialIngest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callIngestEndpoint('stop'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-ingest-status'] }),
  });
}
