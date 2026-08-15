import { router } from 'expo-router';
import { SimulatorScreen } from '@/common/components/dev/SimulatorScreen';

/**
 * Hidden tab-group route (href: null in _layout.tsx) reached from Profile's
 * "Simulator" row — pushed like Watchlists/Track Portfolio/Run Simulation
 * rather than shown as its own tab icon.
 */
export default function SimulatorRoute() {
  return <SimulatorScreen onClose={() => router.back()} />;
}
