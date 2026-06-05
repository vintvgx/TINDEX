import React from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

interface FlowInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

interface SectionProps {
  icon: string;
  iconColor: string;
  title: string;
  badge?: { label: string; color: string };
  children: React.ReactNode;
  colors: ReturnType<typeof useThemeColors>;
}

const Section: React.FC<SectionProps> = ({ icon, iconColor, title, badge, children, colors }) => (
  <View style={{
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: iconColor + '18',
        borderWidth: 1, borderColor: iconColor + '40',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }}>{title}</Text>
      {badge && (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
          backgroundColor: badge.color + '20', borderWidth: 1, borderColor: badge.color + '50',
        }}>
          <Text style={{ color: badge.color, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
            {badge.label}
          </Text>
        </View>
      )}
    </View>
    {children}
  </View>
);

const Bullet: React.FC<{ text: string; color: string; colors: ReturnType<typeof useThemeColors> }> = ({ text, color, colors }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, marginTop: 6 }} />
    <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, flex: 1 }}>{text}</Text>
  </View>
);

const ScoreRow: React.FC<{ label: string; value: string; colors: ReturnType<typeof useThemeColors> }> = ({ label, value, colors }) => (
  <View style={{
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator,
  }}>
    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
  </View>
);

export const FlowInfoModal: React.FC<FlowInfoModalProps> = ({ visible, onClose }) => {
  const colors = useThemeColors();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingVertical: 16,
          borderBottomWidth: 1, borderBottomColor: colors.separator,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 32, height: 32, borderRadius: 8,
              backgroundColor: colors.accent + '18',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="pulse-outline" size={16} color={colors.accent} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>Flow Guide</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: colors.iconButton,
              borderWidth: 1, borderColor: colors.iconButtonBorder,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Intro blurb */}
          <Text style={{
            color: colors.textSecondary, fontSize: 13, lineHeight: 20,
            marginBottom: 16, paddingHorizontal: 4,
          }}>
            Option flow tracks where institutional money is moving. Large, aggressive, or unusual trades
            are flagged as signals that smart money may be positioning ahead of a move.
          </Text>

          {/* ── SWEEP ── */}
          <Section
            icon="flash-outline"
            iconColor="#FF9F0A"
            title="Sweep"
            badge={{ label: 'SWEEP', color: '#FF9F0A' }}
            colors={colors}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 10 }}>
              A sweep is an aggressive buy that hits multiple exchanges simultaneously to fill a large order
              as fast as possible — prioritizing speed over price. It signals urgency.
            </Text>
            <Bullet color="#FF9F0A" colors={colors} text="Trader didn't wait for a better price — they needed in immediately." />
            <Bullet color="#FF9F0A" colors={colors} text="Multi-exchange execution means the order was too large for a single venue." />
            <Bullet color="#FF9F0A" colors={colors} text="Sweeps on the ask side are the most bullish signal — someone is aggressively buying calls." />
            <Bullet color="#FF9F0A" colors={colors} text="A put sweep is bearish — someone is aggressively buying downside protection." />
            <View style={{
              marginTop: 10, padding: 12, borderRadius: 10,
              backgroundColor: '#FF9F0A12', borderWidth: 1, borderColor: '#FF9F0A30',
            }}>
              <Text style={{ color: '#FF9F0A', fontSize: 12, fontWeight: '600' }}>
                Reading it: AAPL $195C · SWEEP · ASK · $437K
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                Someone paid ask price (no negotiation) across exchanges for $437K worth of AAPL calls — highly bullish.
              </Text>
            </View>
          </Section>

          {/* ── FLOOR ── */}
          <Section
            icon="business-outline"
            iconColor="#5856D6"
            title="Floor Block"
            badge={{ label: 'FLOOR', color: '#5856D6' }}
            colors={colors}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 10 }}>
              A floor trade is a large block executed directly on the exchange floor — typically by institutions
              like hedge funds, pension funds, or market makers. These are deliberate, negotiated positions.
            </Text>
            <Bullet color="#5856D6" colors={colors} text="Usually six- or seven-figure premium — these are serious positions." />
            <Bullet color="#5856D6" colors={colors} text="Floor trades are slower and more calculated than sweeps — less urgency, more conviction." />
            <Bullet color="#5856D6" colors={colors} text="Bid-side floor = institution is selling calls or buying puts — bearish hedge." />
            <Bullet color="#5856D6" colors={colors} text="Ask-side floor = institution opening a large bullish position." />
            <View style={{
              marginTop: 10, padding: 12, borderRadius: 10,
              backgroundColor: '#5856D612', borderWidth: 1, borderColor: '#5856D630',
            }}>
              <Text style={{ color: '#5856D6', fontSize: 12, fontWeight: '600' }}>
                Reading it: SPY $510P · FLOOR · BID · $1.05M
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                A fund placed $1.05M in SPY puts via the floor. Bid-side means they may be hedging a long
                portfolio or outright betting on downside.
              </Text>
            </View>
          </Section>

          {/* ── ASK vs BID side ── */}
          <Section
            icon="swap-horizontal-outline"
            iconColor={colors.accent}
            title="ASK vs BID Side"
            colors={colors}
          >
            <View style={{ gap: 0 }}>
              <ScoreRow label="ASK side" value="Aggressive buyer — bullish for calls" colors={colors} />
              <ScoreRow label="BID side" value="Aggressive seller — bearish signal" colors={colors} />
              <ScoreRow label="ASK + Call" value="Strong bullish signal" colors={colors} />
              <ScoreRow label="ASK + Put" value="Bearish — buying downside fast" colors={colors} />
              <View style={{ paddingVertical: 8 }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18 }}>
                  A trade executed at the ask means the buyer was willing to pay the full asking price —
                  they didn't wait. That urgency is the signal.
                </Text>
              </View>
            </View>
          </Section>

          {/* ── UNUSUAL SCORE ── */}
          <Section
            icon="analytics-outline"
            iconColor={colors.accent}
            title="Unusual Score"
            colors={colors}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 10 }}>
              Unusual Whales' proprietary 0–100 score measuring how abnormal a trade is relative to
              historical activity for that ticker and contract type.
            </Text>

            <View style={{ marginBottom: 12 }}>
              <ScoreRow label="Volume vs Open Interest" value="30%" colors={colors} />
              <ScoreRow label="Premium size vs average" value="25%" colors={colors} />
              <ScoreRow label="Trade urgency (sweep/floor)" value="20%" colors={colors} />
              <ScoreRow label="Time of day + DTE" value="15%" colors={colors} />
              <ScoreRow label="Repeat activity on ticker" value="10%" colors={colors} />
            </View>

            {/* Score legend */}
            {[
              { range: '90 – 100', label: 'Extremely unusual — rare institutional signal', color: colors.error },
              { range: '75 – 89',  label: 'Highly unusual — worth close attention',        color: '#FF9F0A' },
              { range: '60 – 74',  label: 'Notable — elevated activity',                   color: colors.success },
              { range: 'Below 60', label: 'Mildly unusual — background noise',             color: colors.textTertiary },
            ].map(row => (
              <View key={row.range} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.separator,
              }}>
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                  backgroundColor: row.color + '18', minWidth: 72, alignItems: 'center',
                }}>
                  <Text style={{ color: row.color, fontSize: 11, fontWeight: '700' }}>{row.range}</Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 }}>{row.label}</Text>
              </View>
            ))}

            <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 10, lineHeight: 17 }}>
              A high score alone isn't a buy signal — combine it with the side, premium size, and
              whether the trade is opening new positions (OI increase) to build conviction.
            </Text>
          </Section>

          {/* ── 0DTE ── */}
          <Section
            icon="timer-outline"
            iconColor={colors.error}
            title="0DTE & Expiry Filters"
            colors={colors}
          >
            <Bullet color={colors.error} colors={colors} text="0DTE (zero days to expiry) — contract expires today. Extremely high gamma, lottery-ticket risk/reward. Flow here means someone is making a very short-term directional bet." />
            <Bullet color="#FF9F0A" colors={colors} text="This Week — expiring within the current trading week. Short-term conviction without the extreme decay of 0DTE." />
            <Bullet color={colors.success} colors={colors} text="All — no expiry filter. Shows the full picture including LEAPS and longer-dated positions." />
            <View style={{
              marginTop: 10, padding: 12, borderRadius: 10,
              backgroundColor: colors.error + '10', borderWidth: 1, borderColor: colors.error + '25',
            }}>
              <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                0DTE warning
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
                Large 0DTE sweeps can move the underlying price due to dealer gamma hedging. If you see
                a massive 0DTE call sweep, market makers may be forced to buy shares — amplifying the move.
              </Text>
            </View>
          </Section>

          {/* ── How to use it ── */}
          <Section
            icon="checkmark-circle-outline"
            iconColor={colors.success}
            title="How to Use Flow as a Signal"
            colors={colors}
          >
            <View style={{ gap: 0 }}>
              <ScoreRow label="Step 1" value="Check the Flow Bias bar" colors={colors} />
              <ScoreRow label="Step 2" value="Filter to your ticker" colors={colors} />
              <ScoreRow label="Step 3" value="Look for ASK-side sweeps" colors={colors} />
              <ScoreRow label="Step 4" value="Score ≥ 75 adds confidence" colors={colors} />
              <ScoreRow label="Step 5" value="Cross-check with Chain (OI + IV)" colors={colors} />
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 10, lineHeight: 18 }}>
              Flow confirms — it doesn't originate — a trade idea. Use it as a second opinion
              alongside your group's thesis, not as a standalone signal.
            </Text>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};
