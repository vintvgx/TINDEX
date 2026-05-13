import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { supabase } from '@/lib/supabase/supabase';
import type { AgentConversation, AgentMessage } from '@/common/types/agent';

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
