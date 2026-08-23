import React, { useState, useRef, useEffect, useCallback } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoClipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAgentConversations, useAgentMessages } from '@/hooks/queries/agent/useAgentConversations';
import { streamAgentChat, parseFlowScreenshot } from '@/common/services/AgentService';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChecklistCard, type ChecklistStatus } from '@/common/components/agent/ChecklistCard';
import type { AgentConversation, FlowChecklist } from '@/common/types/agent';

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

const TypingDots: React.FC<{ color: string }> = ({ color }) => {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '·')), 400);
    return () => clearInterval(id);
  }, []);
  return <Text style={{ color, fontSize: 18, letterSpacing: 3 }}>{dots || '·'}</Text>;
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
          <TypingDots color={colors.textTertiary} />
        ) : item.content ? (
          <Text style={[ms.text, { color: isUser ? '#fff' : colors.text, marginTop: item.imageUri ? 8 : 0 }]}>
            {item.content}
          </Text>
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
      activeChecklistIdRef.current = null;
    }
  }, [visible]);

  // Populate local messages from Supabase when loading a saved conversation
  useEffect(() => {
    if (savedMessages.length > 0 && localMessages.length === 0) {
      setLocalMessages(
        savedMessages.map(m => ({ id: m.id, role: m.role, content: m.content })),
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

  const handleChecklistResolved = useCallback((msgId: string, status: 'submitted' | 'skipped') => {
    setLocalMessages(prev => prev.map(m => (m.id === msgId ? { ...m, checklistStatus: status } : m)));
    if (activeChecklistIdRef.current === msgId) activeChecklistIdRef.current = null;
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
      setLocalMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '', isStreaming: true }]);

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
        const checklistMsgId = `local-checklist-${Date.now()}`;
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
          <ChecklistCard
            checklist={item.checklist}
            status={item.checklistStatus ?? 'pending'}
            onResolved={(status) => handleChecklistResolved(item.id, status)}
            colors={colors}
          />
        </View>
      ) : (
        <MessageBubble item={item} colors={colors} accentColor={colors.accent} />
      ),
    [colors, handleChecklistResolved],
  );

  const renderConversation = useCallback(
    ({ item }: { item: AgentConversation }) => (
      <TouchableOpacity
        onPress={() => openConversation(item)}
        activeOpacity={0.7}
        style={[s.convoItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
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
        <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
      </TouchableOpacity>
    ),
    [colors, openConversation],
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
            <Text style={[s.headerTitle, { color: colors.text }]}>AI Agent</Text>
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
                    color={(inputText.trim() || pendingImage) && !isStreaming ? '#fff' : colors.textTertiary}
                  />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAI: { borderWidth: 1, borderBottomLeftRadius: 4 },
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
