import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { supabase } from '@/lib/supabase/supabase';
import type { AgentConversation, AgentMessage, FlowChecklist } from '@/common/types/agent';

export function useAgentConversations() {
  const { authState: { user } } = useAuth();

  return useQuery({
    queryKey: ['agent-conversations', user?.id],
    queryFn: async (): Promise<AgentConversation[]> => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AgentConversation[];
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

/**
 * Deletes a conversation (and, via ON DELETE CASCADE on ai_messages, its
 * full message history — see mobile/supabase/ai_agent.sql). Worth surfacing
 * explicitly since the screenshot itself is never saved (see AgentModal's
 * parse-screenshot flow) — once a conversation's image context is gone, an
 * old thread built around "here's what I found in this screenshot" reads as
 * meaningless leftover clutter with nothing left to act on.
 */
export function useDeleteAgentConversation() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string): Promise<void> => {
      if (!user?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', conversationId)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
      queryClient.removeQueries({ queryKey: ['agent-messages', conversationId] });
    },
  });
}

/**
 * Persists a checklist's resolution (submitted/skipped) directly to its
 * ai_messages row so it survives a reload — the same row the backend wrote
 * at parse time (see agent_routes.py's checklistMessageId). Writes the full
 * checklist object back alongside the new status (not a partial column
 * update) since Postgres JSONB columns are replaced wholesale, not merged.
 */
export function useUpdateChecklistStatus() {
  return useMutation({
    mutationFn: async ({ messageId, checklist, status }: {
      messageId: string;
      checklist: FlowChecklist;
      status: 'submitted' | 'skipped';
    }): Promise<void> => {
      const { error } = await supabase
        .from('ai_messages')
        .update({ metadata: { checklist, checklist_status: status } })
        .eq('id', messageId);
      if (error) throw error;
    },
  });
}

export function useAgentMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['agent-messages', conversationId],
    queryFn: async (): Promise<AgentMessage[]> => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AgentMessage[];
    },
    enabled: !!conversationId,
    staleTime: 10_000,
  });
}
