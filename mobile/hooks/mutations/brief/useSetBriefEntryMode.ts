import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import { useToast } from '@/common/components/ui/Toast';

/** Set a ticker's entry-mode preference (confirm = ask first, auto = enter on
 *  trigger). Honored by the 9:00 ET brief build; default is confirm. */
export function useSetBriefEntryMode() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ ticker, mode }: { ticker: string; mode: 'confirm' | 'auto' }) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/brief/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ ticker, mode }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) throw new Error(json.error ?? `Request failed (${resp.status})`);
      return json.data as { ticker: string; mode: 'confirm' | 'auto' };
    },
    onSuccess: ({ ticker, mode }) => {
      qc.setQueryData<Record<string, 'confirm' | 'auto'>>(['brief-entry-modes'], (m) => ({
        ...(m ?? {}),
        [ticker]: mode,
      }));
      toast.info(mode === 'auto'
        ? `${ticker}: auto-enter on trigger`
        : `${ticker}: ask before entering`);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['brief-entry-modes'] }),
  });
}
