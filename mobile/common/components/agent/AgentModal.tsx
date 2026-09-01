import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoClipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAgentConversations, useAgentMessages, useDeleteAgentConversation, useUpdateChecklistStatus } from '@/hooks/queries/agent/useAgentConversations';
import { streamAgentChat, parseFlowScreenshot } from '@/common/services/AgentService';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChecklistCard, type ChecklistStatus } from '@/common/components/agent/ChecklistCard';
import { TradeContractQuickCard } from '@/common/components/ticker/TradeContractSheet';
import type { AgentConversation, FlowChecklist } from '@/common/types/agent';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  ticker?: string;
  onError?: (message: string) => void;
}

type LocalMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  imageUri?: string;
  checklist?: FlowChecklist;
  checklistStatus?: ChecklistStatus;
  // Shown next to the loading dots while isStreaming && !content — gives
  // the wait some context (parsing a screenshot takes noticeably longer
  // than a normal chat reply) instead of a bare dots-only bubble.
  loadingLabel?: string;
};

interface PendingImage {
  base64: string;    // raw base64, no "data:" prefix
  mediaType: string;
  previewUri: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Message bubble ───────────────────────────────────────────────────────────

// Staggered 3-dot bounce (iMessage/Slack-style), replacing the old
// text-cycling "·"/"··"/"···" — each dot lifts and brightens on its own
// offset in a continuous loop, driven by the native driver so it stays
// smooth regardless of JS-thread load while a request is in flight.
const TypingDots: React.FC<{ color: string }> = ({ color }) => {
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = anims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 130),
          Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 260, useNativeDriver: true }),
          Animated.delay((2 - i) * 130),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [anims]);

  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 3 }}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }}
        />
      ))}
    </View>
  );
};

interface MessageBubbleProps {
  item: LocalMessage;
  colors: ReturnType<typeof useThemeColors>;
  accentColor: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ item, colors, accentColor }) => {
  const isUser = item.role === 'user';

  const handleLongPress = useCallback(() => {
    if (item.content) ExpoClipboard.setStringAsync(item.content);
  }, [item.content]);

  // User bubbles sit on a solid accent fill (white text); assistant bubbles
  // sit on colors.surface — each needs its own markdown palette rather than
  // one shared style set.
  const markdownStyles = useMemo(() => {
    // User bubbles sit on a solid colors.accent fill — accentForeground is
    // the theme's own pre-computed contrast color for that background (NOT
    // hardcoded white: in this app's dark theme, accent is a light
    // off-white fill, so white text on it would be nearly invisible —
    // exactly the class of bug accentForeground exists to prevent).
    const textColor = isUser ? colors.accentForeground : colors.text;
    const mutedColor = isUser ? colors.accentForeground + 'B3' : colors.textTertiary;
    const codeBg = isUser ? colors.accentForeground + '29' : colors.surfaceSecondary;
    const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
    return {
      body: { color: textColor, fontSize: 15, lineHeight: 22 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      strong: { fontWeight: '700' as const, color: textColor },
      em: { fontStyle: 'italic' as const },
      // Headings get real separation from the body below them — this is the
      // "$TICKER — setup" title line the reply is instructed to open with,
      // so it needs to read as a distinct title, not just slightly-bigger text.
      heading1: { color: textColor, fontSize: 20, fontWeight: '800' as const, marginTop: 0, marginBottom: 10 },
      heading2: { color: textColor, fontSize: 18, fontWeight: '800' as const, marginTop: 0, marginBottom: 9 },
      heading3: { color: textColor, fontSize: 16, fontWeight: '700' as const, marginTop: 4, marginBottom: 6 },
      bullet_list: { marginVertical: 3 },
      ordered_list: { marginVertical: 3 },
      list_item: { flexDirection: 'row' as const, marginBottom: 7, alignItems: 'flex-start' as const },
      bullet_list_icon: { color: mutedColor, marginRight: 8, fontSize: 15, lineHeight: 22 },
      bullet_list_content: { flex: 1 },
      ordered_list_icon: { color: textColor, marginRight: 8, fontSize: 15, lineHeight: 22, fontWeight: '700' as const },
      ordered_list_content: { flex: 1 },
      code_inline: {
        backgroundColor: codeBg, color: textColor, borderRadius: 4,
        paddingHorizontal: 4, fontFamily: monoFont, fontSize: 13,
      },
      code_block: {
        backgroundColor: codeBg, color: textColor, borderRadius: 8,
        padding: 10, fontFamily: monoFont, fontSize: 13,
      },
      fence: {
        backgroundColor: codeBg, color: textColor, borderRadius: 8,
        padding: 10, fontFamily: monoFont, fontSize: 13,
      },
      link: { color: isUser ? colors.accentForeground : accentColor, textDecorationLine: 'underline' as const },
      hr: { backgroundColor: mutedColor, height: 1, marginVertical: 10 },
      blockquote: {
        borderLeftWidth: 3, borderLeftColor: mutedColor, paddingLeft: 10,
        marginVertical: 6, opacity: 0.9,
      },
      table: { borderColor: mutedColor, borderWidth: 1, borderRadius: 6, marginVertical: 6 },
      thead: { backgroundColor: codeBg },
      th: { padding: 6, fontWeight: '700' as const, color: textColor },
      td: { padding: 6, color: textColor, borderColor: mutedColor },
      tr: { borderColor: mutedColor },
    };
  }, [isUser, colors, accentColor]);

  return (
    <View style={[ms.row, isUser ? ms.rowUser : ms.rowAI]}>
      {!isUser && (
        <View style={[ms.avatar, { backgroundColor: accentColor + '20' }]}>
          <Ionicons name="sparkles" size={13} color={accentColor} />
        </View>
      )}
      <TouchableOpacity
        onLongPress={handleLongPress}
        activeOpacity={0.85}
        disabled={!item.content}
        style={[
          ms.bubble,
          isUser
            ? [ms.bubbleUser, { backgroundColor: accentColor }]
            : [ms.bubbleAI, { backgroundColor: colors.surface, borderColor: colors.border }],
        ]}
      >
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={ms.attachedImage} resizeMode="cover" />
        ) : null}
        {item.isStreaming && !item.content ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {item.loadingLabel ? (
              <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: '500' }}>
                {item.loadingLabel}
              </Text>
            ) : null}
            <TypingDots color={colors.textTertiary} />
          </View>
        ) : item.content ? (
          <View style={item.imageUri ? { marginTop: 8 } : undefined}>
            <Markdown style={markdownStyles}>{item.content}</Markdown>
          </View>
        ) : null}
        {item.isStreaming && item.content ? (
          <View style={ms.streamingCursor}>
            <View style={[ms.cursor, { backgroundColor: colors.textTertiary }]} />
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const AgentModal: React.FC<Props> = ({ visible, onClose, ticker, onError }) => {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'home' | 'thread'>('home');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  // Trade-entry overlay, opened by long-pressing a contract in a checklist —
  // TradeContractQuickCard (same profile/quantity/paper-live form as
  // TradeContractSheet, rendered as an animated overlay inside THIS modal
  // instead of a second native Modal — see TradeContractSheet.tsx). Reset
  // along with everything else when this modal closes (below); unlike the
  // old close-and-reopen handoff, nothing here needs to survive that.
  const [tradeSheetVisible, setTradeSheetVisible] = useState(false);
  const [tradeSheetTicker, setTradeSheetTicker] = useState('');
  const [tradeSheetContract, setTradeSheetContract] = useState<OptionsContract | null>(null);
  const [tradeSheetCurrentPrice, setTradeSheetCurrentPrice] = useState(0);
  // Contract-premium entry/stop from the alert, when the checklist's parsed
  // contract had one — lets TradeContractQuickCard pre-set a stop matched
  // to what the alert specified (see its alertEntryPrice/alertStopLoss docs).
  const [tradeSheetAlertEntry, setTradeSheetAlertEntry] = useState<number | null>(null);
  const [tradeSheetAlertStopLoss, setTradeSheetAlertStopLoss] = useState<number | null>(null);

  const scrollRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  // Ref to avoid stale closure on conversationId during streaming
  const conversationIdRef = useRef<string | null>(null);
  useEffect(() => { conversationIdRef.current = activeConversationId; }, [activeConversationId]);
  // Id of the most recent still-pending checklist message — while set, a
  // plain text send is treated as a correction to THAT checklist (re-parsed
  // from the extracted JSON, not the original image, which is never resent
  // or stored) rather than a normal chat turn.
  const activeChecklistIdRef = useRef<string | null>(null);

  const { data: conversations = [], refetch: refetchConversations } = useAgentConversations();
  const { data: savedMessages = [] } = useAgentMessages(activeConversationId);
  const { mutate: deleteConversation, isPending: isDeletingConvo, variables: deletingConvoId } = useDeleteAgentConversation();
  const { mutate: persistChecklistStatus } = useUpdateChecklistStatus();

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setView('home');
      setActiveConversationId(null);
      setLocalMessages([]);
      setInputText('');
      setIsStreaming(false);
      setError(null);
      setPendingPrompt(null);
      setPendingImage(null);
      setTradeSheetVisible(false);
      activeChecklistIdRef.current = null;
    }
  }, [visible]);

  // Populate local messages from Supabase when loading a saved conversation
  // — a checklist message (empty content, metadata.checklist set) becomes a
  // real ChecklistCard again, at whatever status it was last left in, not a
  // blank bubble (see ai_messages.metadata's migration doc comment).
  useEffect(() => {
    if (savedMessages.length > 0 && localMessages.length === 0) {
      setLocalMessages(
        savedMessages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          checklist: m.metadata?.checklist,
          checklistStatus: m.metadata?.checklist_status,
        })),
      );
    }
  }, [savedMessages]);

  // Auto-send pending prompt once thread view is active
  useEffect(() => {
    if (view === 'thread' && pendingPrompt !== null) {
      const msg = pendingPrompt;
      setPendingPrompt(null);
      sendMessage(msg);
    }
  }, [view, pendingPrompt]);

  const handleChecklistResolved = useCallback((msgId: string, checklist: FlowChecklist, status: 'submitted' | 'skipped') => {
    setLocalMessages(prev => prev.map(m => (m.id === msgId ? { ...m, checklistStatus: status } : m)));
    if (activeChecklistIdRef.current === msgId) activeChecklistIdRef.current = null;
    // "local-" ids are client-only placeholders from a failed/unsent save —
    // nothing to persist against. A real (backend-assigned) id means the
    // checklist's own ai_messages row exists and can be updated in place.
    if (!msgId.startsWith('local-')) {
      persistChecklistStatus({ messageId: msgId, checklist, status });
    }
  }, [persistChecklistStatus]);

  // Long-pressing a contract in a checklist opens TradeContractQuickCard —
  // an animated overlay INSIDE this same Modal (see TradeContractSheet.tsx),
  // not a second native Modal. This assistant modal never closes for the
  // handoff, so its conversation/checklist state is never lost and there's
  // no close/reopen animation to wait out.
  const handleTradeContract = useCallback((
    tickerArg: string, liveContract: OptionsContract, currentPrice: number,
    alertEntryPrice?: number | null, alertStopLoss?: number | null,
  ) => {
    if (!tickerArg) return;
    setTradeSheetTicker(tickerArg);
    setTradeSheetContract(liveContract);
    setTradeSheetCurrentPrice(currentPrice);
    setTradeSheetAlertEntry(alertEntryPrice ?? null);
    setTradeSheetAlertStopLoss(alertStopLoss ?? null);
    setTradeSheetVisible(true);
  }, []);

  const sendMessage = useCallback(async (text: string, image?: PendingImage | null) => {
    const trimmed = text.trim();
    const revisingId = image ? null : activeChecklistIdRef.current;
    if ((!trimmed && !image) || isStreaming || !user?.id) return;

    setInputText('');
    setPendingImage(null);
    setError(null);

    const userMsgId = `local-user-${Date.now()}`;
    setLocalMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: trimmed, imageUri: image?.previewUri },
    ]);
    scrollRef.current?.scrollToEnd({ animated: false });

    // Screenshot parse (image attached) or a checklist revision (plain text
    // while a checklist is still pending) — both hit the non-streaming
    // parse-screenshot endpoint instead of the normal chat stream.
    if (image || revisingId) {
      setIsStreaming(true);
      const aiMsgId = `local-ai-${Date.now()}`;
      setLocalMessages(prev => [...prev, {
        id: aiMsgId, role: 'assistant', content: '', isStreaming: true,
        loadingLabel: image ? 'Reading screenshot…' : 'Revising…',
      }]);

      const previousChecklist = revisingId
        ? localMessages.find(m => m.id === revisingId)?.checklist
        : undefined;

      try {
        const result = await parseFlowScreenshot({
          userId: user.id,
          conversationId: conversationIdRef.current ?? undefined,
          message: trimmed || undefined,
          imageBase64: image?.base64,
          mediaType: image?.mediaType,
          previousChecklist,
        });
        if (result.conversationId && !conversationIdRef.current) {
          setActiveConversationId(result.conversationId);
        }
        // Real backend id when the checklist's own ai_messages row saved
        // successfully — falls back to a local-only placeholder (never
        // persisted, see handleChecklistResolved's guard) if it didn't.
        const checklistMsgId = result.checklistMessageId || `local-checklist-${Date.now()}`;
        setLocalMessages(prev =>
          prev
            .map(m => (m.id === aiMsgId ? { ...m, content: result.checklist.reply, isStreaming: false } : m))
            .concat({ id: checklistMsgId, role: 'assistant', content: '', checklist: result.checklist, checklistStatus: 'pending' }),
        );
        activeChecklistIdRef.current = checklistMsgId;
        setIsStreaming(false);
        refetchConversations();
        if (result.conversationId) {
          queryClient.invalidateQueries({ queryKey: ['agent-messages', result.conversationId] });
        }
        scrollRef.current?.scrollToEnd({ animated: false });
      } catch (e) {
        setIsStreaming(false);
        setLocalMessages(prev => prev.filter(m => m.id !== aiMsgId));
        const msg = e instanceof Error ? e.message : 'Failed to parse screenshot';
        setError(msg);
        onError?.(msg);
      }
      return;
    }

    const aiMsgId = `local-ai-${Date.now()}`;
    setLocalMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '', isStreaming: true }]);
    setIsStreaming(true);

    let accumulated = '';

    await streamAgentChat(
      {
        userId: user.id,
        message: trimmed,
        conversationId: conversationIdRef.current ?? undefined,
        ticker,
      },
      (chunk) => {
        accumulated += chunk;
        setLocalMessages(prev =>
          prev.map(m => m.id === aiMsgId ? { ...m, content: accumulated } : m),
        );
        scrollRef.current?.scrollToEnd({ animated: false });
      },
      (response) => {
        setIsStreaming(false);
        if (response.conversationId && !conversationIdRef.current) {
          setActiveConversationId(response.conversationId);
        }
        setLocalMessages(prev =>
          prev.map(m =>
            m.id === aiMsgId
              ? { ...m, content: response.response || accumulated, isStreaming: false }
              : m,
          ),
        );
        refetchConversations();
        if (response.conversationId) {
          queryClient.invalidateQueries({ queryKey: ['agent-messages', response.conversationId] });
        }
      },
      (err) => {
        setIsStreaming(false);
        setError(err);
        setLocalMessages(prev => prev.filter(m => m.id !== aiMsgId));
        // Fire toast from parent layer — root-level toasts don't render over a full-screen Modal
        onError?.(err);
      },
    );
  }, [isStreaming, user, ticker, refetchConversations, queryClient, onError, localMessages]);

  const openConversation = useCallback((convo: AgentConversation) => {
    setActiveConversationId(convo.id);
    setLocalMessages([]);
    setView('thread');
  }, []);

  const handleSuggestedPrompt = useCallback((prompt: string) => {
    setActiveConversationId(null);
    setLocalMessages([]);
    setView('thread');
    setPendingPrompt(prompt);
  }, []);

  const handleNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setLocalMessages([]);
    setView('thread');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleBack = useCallback(() => {
    setView('home');
    setActiveConversationId(null);
    setLocalMessages([]);
    setError(null);
    setPendingImage(null);
    activeChecklistIdRef.current = null;
  }, []);

  const handleHomeInput = useCallback((text: string) => {
    setInputText(text);
    if (text.length === 1) {
      setView('thread');
    }
  }, []);

  const handlePickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      onError?.('Photo library permission is required to attach a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    setView('thread');
    setPendingImage({
      base64: asset.base64!,
      mediaType: asset.mimeType || 'image/jpeg',
      previewUri: asset.uri,
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [onError]);

  const handlePasteImage = useCallback(async () => {
    const img = await ExpoClipboard.getImageAsync({ format: 'png' });
    if (!img) {
      onError?.('No image found on the clipboard.');
      return;
    }
    const match = img.data.match(/^data:(image\/\w+);base64,([\s\S]*)$/);
    if (!match) return;
    setView('thread');
    setPendingImage({ base64: match[2], mediaType: match[1], previewUri: img.data });
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [onError]);

  const handleAttachPress = useCallback(() => {
    Alert.alert('Attach a Screenshot', 'Add a flow-alert screenshot to parse into a watch checklist.', [
      { text: 'Choose from Photos', onPress: handlePickImage },
      { text: 'Paste from Clipboard', onPress: handlePasteImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handlePickImage, handlePasteImage]);

  const suggestedPrompts = ticker
    ? [
      `What is the current market sentiment for ${ticker}?`,
      `Analyze the IV environment for ${ticker} options`,
      `What catalysts should I watch for ${ticker}?`,
      `What are the key risks for ${ticker} right now?`,
    ]
    : [
      'Explain how to read options Greeks',
      'What is IV crush and how do I avoid it?',
      'How do I evaluate an options contract risk/reward?',
      'What are the best strategies for volatile markets?',
    ];

  const renderMessage = useCallback(
    ({ item }: { item: LocalMessage }) =>
      item.checklist ? (
        <View style={[ms.row, ms.rowAI]}>
          <View style={[ms.avatar, { backgroundColor: colors.accent + '20' }]}>
            <Ionicons name="sparkles" size={13} color={colors.accent} />
          </View>
          {/* flex: 1, not the avatar-mirroring maxWidth used by chat
              bubbles — a checklist is a form (ticker, watch zone, contract
              picks), not a line of chat, so it should use all the width the
              row has left, not stay bubble-width. */}
          <View style={{ flex: 1 }}>
            <ChecklistCard
              checklist={item.checklist}
              status={item.checklistStatus ?? 'pending'}
              onResolved={(status) => handleChecklistResolved(item.id, item.checklist!, status)}
              onTradeContract={handleTradeContract}
              colors={colors}
            />
          </View>
        </View>
      ) : (
        <MessageBubble item={item} colors={colors} accentColor={colors.accent} />
      ),
    [colors, handleChecklistResolved, handleTradeContract],
  );

  const handleDeleteConversation = useCallback((item: AgentConversation) => {
    Alert.alert(
      'Delete conversation?',
      `"${item.title}" will be permanently deleted. Any screenshot this thread was built around was never saved, so this can't be recovered.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConversation(item.id, {
            onError: (e) => onError?.(e instanceof Error ? e.message : 'Failed to delete conversation'),
          }),
        },
      ],
    );
  }, [deleteConversation, onError]);

  const renderConversation = useCallback(
    ({ item }: { item: AgentConversation }) => {
      const isDeletingThis = isDeletingConvo && deletingConvoId === item.id;
      return (
        <TouchableOpacity
          onPress={() => openConversation(item)}
          disabled={isDeletingThis}
          activeOpacity={0.7}
          style={[s.convoItem, { backgroundColor: colors.surface, borderColor: colors.border, opacity: isDeletingThis ? 0.5 : 1 }]}
        >
          <Ionicons name="chatbubble-outline" size={15} color={colors.textTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.convoTitle, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[s.convoMeta, { color: colors.textTertiary }]}>
              {item.ticker ? `${item.ticker} · ` : ''}{formatRelative(item.updated_at)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDeleteConversation(item)}
            disabled={isDeletingThis}
            hitSlop={8}
            style={{ padding: 4 }}
          >
            {isDeletingThis
              ? <ActivityIndicator size="small" color={colors.textTertiary} />
              : <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />}
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [colors, openConversation, handleDeleteConversation, isDeletingConvo, deletingConvoId],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>

        {/* ── Header ── */}
        <View style={[s.header, { borderBottomColor: colors.separator }]}>
          {view === 'thread' ? (
            <TouchableOpacity onPress={handleBack} hitSlop={10} style={s.headerSideBtn}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={[s.agentIcon, { backgroundColor: colors.accent + '20' }]}>
              <Ionicons name="sparkles" size={16} color={colors.accent} />
            </View>
          )}

          <View style={s.headerCenter}>
            <TouchableOpacity onPress={onClose}>
              <Text style={[s.headerTitle, { color: colors.text }]}>AI Agent</Text>
            </TouchableOpacity>
            {ticker ? (
              <View style={[s.tickerBadge, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}>
                <Text style={[s.tickerText, { color: colors.accent }]}>{ticker}</Text>
              </View>
            ) : null}
          </View>

          <View style={s.headerActions}>
            {view === 'home' && (
              <TouchableOpacity
                onPress={handleNewConversation}
                style={[s.headerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="add" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onClose}
              style={[s.headerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Content ── */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
          keyboardVerticalOffset={4}
        >
          {view === 'home' ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.homeContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Previous conversations */}
              {conversations.length > 0 && (
                <View style={s.section}>
                  <Text style={[s.sectionLabel, { color: colors.textTertiary }]}>RECENT</Text>
                  <FlatList
                    data={conversations.slice(0, 6)}
                    keyExtractor={c => c.id}
                    renderItem={renderConversation}
                    scrollEnabled={false}
                  />
                </View>
              )}

              {/* Suggested prompts */}
              <View style={s.section}>
                <Text style={[s.sectionLabel, { color: colors.textTertiary }]}>
                  {conversations.length === 0 ? 'GET STARTED' : 'SUGGESTED'}
                </Text>
                {suggestedPrompts.map((prompt, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSuggestedPrompt(prompt)}
                    activeOpacity={0.7}
                    style={[s.promptItem, { borderColor: colors.border }]}
                  >
                    <Ionicons name="flash-outline" size={13} color={colors.accent} />
                    <Text style={[s.promptText, { color: colors.text }]}>{prompt}</Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={scrollRef}
              data={localMessages}
              renderItem={renderMessage}
              keyExtractor={item => item.id}
              contentContainerStyle={s.messageList}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <View style={s.emptyThread}>
                  <View style={[s.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Ionicons name="sparkles-outline" size={26} color={colors.accent} />
                  </View>
                  <Text style={[s.emptyTitle, { color: colors.text }]}>
                    {ticker ? `Ask about ${ticker}` : 'What can I help you with?'}
                  </Text>
                  <Text style={[s.emptySubtitle, { color: colors.textSecondary }]}>
                    I can analyze options, explain strategies, search for the latest market news —
                    or read a flow-alert screenshot and turn it into a watch checklist.
                  </Text>
                </View>
              }
            />
          )}

          {/* ── Error banner ── */}
          {error ? (
            <View style={[s.errorBanner, { backgroundColor: colors.error + '18' }]}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
              <Text style={[s.errorText, { color: colors.error }]} numberOfLines={2}>{error}</Text>
              <TouchableOpacity onPress={() => setError(null)} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Revising-checklist hint ── */}
          {view === 'thread' && activeChecklistIdRef.current && !pendingImage ? (
            <View style={[s.hintBanner, { backgroundColor: colors.accent + '14' }]}>
              <Ionicons name="pencil-outline" size={12} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: 11.5, fontWeight: '600', flex: 1 }}>
                Replying will revise the checklist above
              </Text>
            </View>
          ) : null}

          {/* ── Pending image preview ── */}
          {pendingImage ? (
            <View style={[s.imageChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Image source={{ uri: pendingImage.previewUri }} style={s.imageChipThumb} resizeMode="cover" />
              <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }} numberOfLines={1}>
                Screenshot attached — add a caption or just send
              </Text>
              <TouchableOpacity onPress={() => setPendingImage(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── Input row ── */}
          <View style={[s.inputRow, { backgroundColor: colors.background, borderTopColor: colors.separator }]}>
            <TouchableOpacity
              onPress={handleAttachPress}
              disabled={isStreaming}
              hitSlop={6}
              style={[s.attachBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={view === 'home' ? handleHomeInput : setInputText}
              placeholder={
                pendingImage ? 'Add a caption (optional)...'
                  : activeChecklistIdRef.current ? 'Describe the correction...'
                    : ticker ? `Ask about ${ticker}...` : 'Ask anything...'
              }
              placeholderTextColor={colors.textTertiary}
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              multiline
              maxLength={2000}
              editable={!isStreaming}
              returnKeyType="default"
            />
            <TouchableOpacity
              onPress={() => {
                if (view === 'home') {
                  setView('thread');
                  setPendingPrompt(inputText);
                  setInputText('');
                } else {
                  sendMessage(inputText, pendingImage);
                }
              }}
              disabled={(!inputText.trim() && !pendingImage) || isStreaming}
              style={[
                s.sendBtn,
                {
                  backgroundColor: (inputText.trim() || pendingImage) && !isStreaming ? colors.accent : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {isStreaming
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Ionicons
                  name="arrow-up"
                  size={18}
                  color={(inputText.trim() || pendingImage) && !isStreaming ? colors.accentForeground : colors.textTertiary}
                />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* Overlays this modal's own content instead of stacking a second
            native Modal — see TradeContractQuickCard's doc comment. */}
        <TradeContractQuickCard
          visible={tradeSheetVisible}
          onClose={() => setTradeSheetVisible(false)}
          colors={colors}
          ticker={tradeSheetTicker}
          contract={tradeSheetContract}
          currentPrice={tradeSheetCurrentPrice}
          alertEntryPrice={tradeSheetAlertEntry}
          alertStopLoss={tradeSheetAlertStopLoss}
        />
      </SafeAreaView>
    </Modal>
  );
};

// ─── Message styles ───────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowAI: { justifyContent: 'flex-start' },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  // User messages are almost always short (a caption, a correction) — a cap
  // keeps them reading as chat bubbles. Assistant responses are the actual
  // content people are here to read (bulleted breakdowns, checklists) and
  // were cramped into the same ~78% column with a wall of empty space next
  // to them — those get the full row instead.
  bubbleUser: { maxWidth: '80%', borderBottomRightRadius: 4 },
  bubbleAI: { maxWidth: '95%', borderWidth: 1, borderBottomLeftRadius: 4 },
  text: { fontSize: 15, lineHeight: 22 },
  streamingCursor: { marginTop: 4 },
  cursor: { width: 2, height: 16, borderRadius: 1 },
  attachedImage: { width: 200, height: 150, borderRadius: 12 },
});

// ─── Screen styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headerSideBtn: { width: 36, alignItems: 'flex-start' },
  agentIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  tickerBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  tickerText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  homeContent: { paddingBottom: 16 },
  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    marginBottom: 10,
  },
  convoItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 8,
  },
  convoTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  convoMeta: { fontSize: 12 },
  promptItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13,
    marginBottom: 8,
  },
  promptText: { flex: 1, fontSize: 14, fontWeight: '500' },
  messageList: { padding: 16, paddingBottom: 12 },
  emptyThread: {
    alignItems: 'center', paddingTop: 80, paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: {
    fontSize: 13, textAlign: 'center',
    lineHeight: 19, marginTop: 6,
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10,
  },
  errorText: { flex: 1, fontSize: 12 },
  hintBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  imageChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 12, marginBottom: 8,
    padding: 8, borderRadius: 12, borderWidth: 1,
  },
  imageChipThumb: { width: 40, height: 40, borderRadius: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
});
