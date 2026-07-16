import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSocialSignalAccounts } from '@/hooks/queries/social/useSocialSignalAccounts';
import { useFollowAccount } from '@/hooks/mutations/social/useFollowAccount';
import { useUpdateSocialSignalAccount, useUnfollowAccount } from '@/hooks/mutations/social/useUpdateSocialSignalAccount';
import { useToast } from '@/common/components/ui/Toast';
import type { SocialSignalAccount } from '@/common/types/social';

interface Props {
  colors: any;
}

export function FollowedAccountsSection({ colors }: Props) {
  const { data: accounts, isLoading } = useSocialSignalAccounts();
  const [addOpen, setAddOpen] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const follow = useFollowAccount();
  const toast = useToast();

  const handleFollow = () => {
    const handle = handleInput.trim().replace(/^@/, '');
    if (!handle) return;
    follow.mutate({ handle }, {
      onSuccess: () => { toast.success(`Following @${handle}`); setHandleInput(''); setAddOpen(false); },
      onError: (e) => toast.error(e.message || 'Failed to follow account'),
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Followed Accounts</Text>
        <TouchableOpacity
          onPress={() => setAddOpen(o => !o)}
          hitSlop={8}
          style={[styles.addBtn, { backgroundColor: colors.accent }]}
        >
          <Ionicons name={addOpen ? 'close' : 'add'} size={18} color={colors.accentForeground ?? '#fff'} />
        </TouchableOpacity>
      </View>

      {addOpen && (
        <View style={[styles.addRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.at, { color: colors.tabBarInactive }]}>@</Text>
          <TextInput
            value={handleInput}
            onChangeText={setHandleInput}
            placeholder="handle"
            placeholderTextColor={colors.tabBarInactive}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
            onSubmitEditing={handleFollow}
            returnKeyType="go"
          />
          <TouchableOpacity
            onPress={handleFollow}
            disabled={!handleInput.trim() || follow.isPending}
            style={[styles.followBtn, { backgroundColor: handleInput.trim() ? colors.accent : colors.border }]}
          >
            {follow.isPending
              ? <ActivityIndicator size="small" color={colors.accentForeground ?? '#fff'} />
              : <Text style={[styles.followBtnText, { color: colors.accentForeground ?? '#fff' }]}>Follow</Text>}
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
      ) : !accounts || accounts.length === 0 ? (
        <Text style={[styles.empty, { color: colors.tabBarInactive }]}>
          No accounts followed yet — tap + to follow one.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {accounts.map(a => <AccountRow key={a.id} account={a} colors={colors} />)}
        </View>
      )}
    </View>
  );
}

function AccountRow({ account, colors }: { account: SocialSignalAccount; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const [kwInput, setKwInput] = useState('');
  const update = useUpdateSocialSignalAccount();
  const unfollow = useUnfollowAccount();

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (!kw) return;
    update.mutate({ id: account.id, parse_keywords: [...account.parse_keywords, kw] });
    setKwInput('');
  };

  const removeKeyword = (kw: string) => {
    update.mutate({ id: account.id, parse_keywords: account.parse_keywords.filter(k => k !== kw) });
  };

  const confirmUnfollow = () => {
    Alert.alert('Unfollow', `Stop tracking @${account.handle}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unfollow', style: 'destructive', onPress: () => unfollow.mutate(account.id) },
    ]);
  };

  return (
    <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={styles.accountRow} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.handle, { color: colors.text }]}>@{account.handle}</Text>
          <Text style={[styles.keywordSummary, { color: colors.tabBarInactive }]} numberOfLines={1}>
            {account.parse_keywords.length > 0
              ? `Parse for: ${account.parse_keywords.join(', ')}`
              : 'Parse for: everything (no phrases set)'}
          </Text>
        </View>
        <Switch
          value={account.active}
          onValueChange={(v) => update.mutate({ id: account.id, active: v })}
          thumbColor={account.active ? '#30D158' : '#ccc'}
          trackColor={{ true: '#30D15855', false: colors.border }}
        />
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tabBarInactive} style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedBody}>
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>PARSE FOR</Text>
          <View style={styles.chipRow}>
            {account.parse_keywords.map(kw => (
              <View key={kw} style={[styles.chip, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}>
                <Text style={[styles.chipText, { color: colors.accent }]} numberOfLines={1}>{kw}</Text>
                <TouchableOpacity onPress={() => removeKeyword(kw)} hitSlop={6}>
                  <Ionicons name="close" size={12} color={colors.accent} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              value={kwInput}
              onChangeText={setKwInput}
              placeholder='e.g. "HIGH CONFIDENCE"'
              placeholderTextColor={colors.tabBarInactive}
              style={[styles.input, { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10 }]}
              onSubmitEditing={addKeyword}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={addKeyword} disabled={!kwInput.trim()} style={[styles.addKwBtn, { borderColor: colors.border }]}>
              <Ionicons name="add" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
          {account.parse_keywords.length === 0 && (
            <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
              No phrases set — every tweet from this account will be parsed.
            </Text>
          )}
          <TouchableOpacity onPress={confirmUnfollow} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600' }}>Unfollow</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: '700' },
  addBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  at: { fontSize: 14, fontWeight: '600' },
  input: { flex: 1, fontSize: 14, paddingVertical: 4 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, minWidth: 64, alignItems: 'center' },
  followBtnText: { fontSize: 13, fontWeight: '700' },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  accountCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  accountRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  handle: { fontSize: 14, fontWeight: '700' },
  keywordSummary: { fontSize: 11, marginTop: 2 },
  expandedBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  footerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1, maxWidth: 220 },
  chipText: { fontSize: 11, fontWeight: '600' },
  addKwBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, fontStyle: 'italic' },
});
