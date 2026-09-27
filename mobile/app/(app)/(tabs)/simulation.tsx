import { router } from 'expo-router';
import { SimulationChartScreen } from '@/common/components/strategy/SimulationChartScreen';

/**
 * Hidden tab-group route (href: null in _layout.tsx) reached from the Menu
 * tab's "Run Simulation" row — pushed like Watchlists/Track Portfolio/
 * Notifications rather than shown as its own tab icon.
 */
export default function SimulationScreen() {
  return <SimulationChartScreen onClose={() => router.back()} />;
}
