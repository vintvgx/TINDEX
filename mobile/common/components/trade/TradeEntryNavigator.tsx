import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useToast } from '@/common/components/ui/Toast';
import { useChartOverlay } from '@/common/components/ui/ChartOverlayContext';
import { subscribeTradeEntered, setEntryHighlight } from '@/common/services/tradeEntryEvents';

/**
 * Lands a just-entered trade on Home. Mounted once in the tabs shell.
 *
 * On `trade-entered` the hosting sheets/modals are already closing (they
 * subscribe themselves); this waits out their native dismiss animation —
 * navigating under a still-presented Modal leaves a ghost backdrop — then
 * replaces to the feed tab, flags the new position card, and toasts.
 * Backgrounding the app before the timer fires cancels the navigation.
 */
const DISMISS_SETTLE_MS = 450;

export function TradeEntryNavigator() {
  const toast = useToast();
  const { open: chartOpen, closeChart } = useChartOverlay();
  // Refs, so a re-render (new toast/context identity) never re-subscribes
  // and cancels a navigation that's mid-wait.
  const latest = useRef({ chartOpen, closeChart, toast });
  latest.current = { chartOpen, closeChart, toast };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const appSub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') cancel();
    });
    const unsub = subscribeTradeEntered((e) => {
      cancel();
      if (AppState.currentState !== 'active') return;
      setEntryHighlight({ strategyId: e.strategyId, contractSymbol: e.contractSymbol });
      timer.current = setTimeout(() => {
        timer.current = null;
        const { chartOpen: open, closeChart: close, toast: t } = latest.current;
        if (open) close();
        router.replace('/(app)/(tabs)/feed');
        t.success(`✓ ${e.label} open`);
      }, DISMISS_SETTLE_MS);
    });
    return () => {
      cancel();
      unsub();
      appSub.remove();
    };
  }, []);

  return null;
}
