import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';
import type { RobinhoodAuthStatus } from '@/common/types/robinhood';

export interface RobinhoodAuthResponse {
  success: boolean;
  status: RobinhoodAuthStatus;
  message?: string;
}

// Robinhood's unofficial API can just never respond — without this, a
// hung request leaves the "Connecting…" button spinning forever instead of
// surfacing as a failed connection attempt (see useRobinhoodAccount.ts).
const ROBINHOOD_TIMEOUT_MS = 60_000;

/**
 * "Sign In" / "Resend Code" — always a deliberate tap, since it can trigger
 * a fresh Robinhood SMS text. Never called from passive polling (see
 * api's robinhood_service.py docstring for why).
 */
export function useRobinhoodLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RobinhoodAuthResponse> => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/login`, { method: 'POST' }, ROBINHOOD_TIMEOUT_MS);
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['robinhood-account'] });
    },
  });
}

/** Submits the SMS code Robinhood just texted, completing sign-in. */
export function useRobinhoodVerify() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<RobinhoodAuthResponse> => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }, ROBINHOOD_TIMEOUT_MS);
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['robinhood-account'] });
      queryClient.invalidateQueries({ queryKey: ['robinhood-holdings'] });
    },
  });
}
