import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import TickerSheetService from '@/common/services/TickerSheetService';

/**
 * Deep-link shim. The ticker detail view now lives in the global
 * TickerSheetProvider (a bottom sheet), not a routed screen — see
 * NavigationService.toTicker(). This route stays in place only so that
 * external/universal links to /ticker/<symbol> still work: it opens the
 * sheet and immediately drops itself from the nav stack.
 */
export default function TickerDeepLinkShim() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();

  useEffect(() => {
    if (ticker) {
      TickerSheetService.getInstance().open(ticker);
    }
    if (router.canGoBack()) {
      router.back();
    }
  }, [ticker]);

  return null;
}
