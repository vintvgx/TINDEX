import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { supabase } from '@/lib/supabase/supabase';
import type { ContractScore } from '@/common/types/agent';

export function useContractScores() {
  const { authState: { user } } = useAuth();

  return useQuery({
    queryKey: ['contract-scores', user?.id],
    queryFn: async (): Promise<ContractScore[]> => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('ai_contract_scores')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractScore[];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
