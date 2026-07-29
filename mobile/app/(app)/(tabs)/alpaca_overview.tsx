import React from 'react';
import AccountsOverviewScreen from './accounts_overview';

interface Props {
  /** True when rendered as a SegmentedPager scene (Accounts tab). */
  embedded?: boolean;
}

/**
 * Alpaca segment of the Accounts tab. Previously toggled between a Summary
 * view and a separate Live Positions sub-page (two full self-contained
 * screens switched via a tap toggle) — Live Positions is now its own
 * section at the bottom of AccountsOverviewScreen instead (one continuous
 * scroll, no toggle needed), so this is just a pass-through. Kept as its
 * own file rather than inlining AccountsOverviewScreen directly into
 * accounts.tsx's route map, since "Alpaca" (vs. Robin Hood) is the
 * broker-level concept accounts.tsx's pager actually switches on.
 */
export default function AlpacaScreen({ embedded = false }: Props) {
  return <AccountsOverviewScreen embedded={embedded} />;
}
