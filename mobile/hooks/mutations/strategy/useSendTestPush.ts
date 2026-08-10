import { useMutation } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface TestPushResult {
  status: 'ok' | 'error';
  message: string;
}

/**
 * Fires one real Expo push through the same queue every other app
 * notification goes through (see StrategyNotifier.notify_test /
 * POST /strategy/debug/test-push) — no engine or trade required. Lets the
 * Simulator screen verify a device actually receives pushes in isolation
 * from a whole trade simulation.
 */
export function useSendTestPush() {
  return useMutation<TestPushResult, Error, { title?: string; body?: string }>({
    mutationFn: async ({ title, body }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/debug/test-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const json = (await res.json()) as TestPushResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Failed to send test push');
      }
      return json;
    },
  });
}
