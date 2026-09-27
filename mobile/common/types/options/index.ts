
// Options Tracking Types
export interface TrackedOptionContract {
    id: string;
    user_id: string;
    ticker: string;
    contract_symbol: string;
    option_type: 'CALL' | 'PUT';
    strike: number;
    expiration_date: string;
    tracking_snapshot: any; // OptionsOpportunity object
    status: 'tracking' | 'entered' | 'exited' | 'expired' | 'cancelled';
    entry_price?: number;
    entry_date?: string;
    exit_price?: number;
    exit_date?: string;
    position_size?: number;
    pnl?: number;
    pnl_percentage?: number;
    max_profit?: number;
    max_loss?: number;
    held_duration_days?: number;
    tracked_from_source: 'orb_breakout' | 'manual' | 'followed_stock';
    orb_breakout_id?: string;
    initial_analysis_score?: number;
    tracking_reason?: string;
    // Entered-position alert threshold overrides — null/undefined means the
    // 25/50/100 default applies. Only take effect once status === 'entered';
    // tracking-phase alerts always use the fixed 25/50/100 defaults.
    alert_gain_25?: number | null;
    alert_gain_50?: number | null;
    alert_gain_100?: number | null;
    alert_loss_25?: number | null;
    alert_loss_50?: number | null;
    alert_loss_100?: number | null;
    created_at: string;
    updated_at: string;
  }
  
  export interface TrackOptionRequest {
    userId: string;
    ticker: string;
    contractSymbol: string;
    optionType: 'CALL' | 'PUT';
    strike: number;
    expirationDate: string;
    trackingSnapshot: any; // OptionsOpportunity object
    trackedFromSource?: 'orb_breakout' | 'manual' | 'followed_stock';
    orbBreakoutId?: string;
    initialAnalysisScore?: number;
    trackingReason?: string;
  }
  
  export interface UpdateContractStatusRequest {
    userId: string;
    contractId: string;
    status: 'entered' | 'exited' | 'cancelled';
    entryPrice?: number;
    exitPrice?: number;
    positionSize?: number;
  }