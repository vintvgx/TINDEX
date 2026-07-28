import { router } from 'expo-router';

type NotificationData = Record<string, any>;

/**
 * Maps a notification's `data.screen` to the real route. All of these are
 * registered with `href: null` in app/(app)/(tabs)/_layout.tsx specifically
 * so they stay directly `router.push`-able even though they're normally
 * only reached by swiping a pager (see orb.tsx) — see that file's shell
 * comment for the full rationale.
 */
const ROUTE_BY_SCREEN: Record<string, string> = {
  position:     '/(app)/(tabs)/position',
  tradelog:     '/(app)/(tabs)/tradelog',
  strategy:     '/(app)/(tabs)/strategy',
  daily_review: '/(app)/(tabs)/daily_review',
  options:      '/(app)/(tabs)/options',
};

/**
 * Routes a tapped push notification to the screen it's actually about,
 * instead of leaving the user on whatever tab happened to be open when the
 * app foregrounds. Reads the `data` payload every notify_* method in
 * api/services/strategy/notifier.py already attaches — `data.screen` is the
 * one required field; everything else below is screen-specific and optional.
 *
 * `confirm_entry` notifications intentionally still land on `strategy` even
 * though tapping isn't what actually surfaces that modal — PendingConfirmationProvider
 * (mounted at the app root) already polls and shows it globally, over
 * whatever screen is active, the moment the app foregrounds. Navigating
 * there anyway just puts the user somewhere sensible once they dismiss it.
 */
export function navigateFromNotification(data: NotificationData | undefined | null): void {
  if (!data || typeof data !== 'object') return;

  const screen = data.screen as string | undefined;
  if (!screen) return;
  const path = ROUTE_BY_SCREEN[screen];
  if (!path) return;

  const params: Record<string, string> = {};
  if (data.symbol != null)          params.symbol = String(data.symbol);
  if (data.paper_mode != null)      params.paper_mode = String(data.paper_mode);
  if (data.review_date != null)     params.review_date = String(data.review_date);
  if (data.ticker != null)          params.ticker = String(data.ticker);
  if (data.contract_symbol != null) params.contract_symbol = String(data.contract_symbol);
  if (data.pending_id != null)      params.pending_id = String(data.pending_id);

  if (Object.keys(params).length > 0) {
    router.push({ pathname: path as any, params });
  } else {
    router.push(path as any);
  }
}
