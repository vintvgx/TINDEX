import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { scoreContract } from '@/common/services/AgentService';
import type { ContractScoreRequest, ContractScore } from '@/common/types/agent';

export function useScoreContract() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      request: Omit<ContractScoreRequest, 'userId'>,
    ): Promise<ContractScore> => {
      if (!user?.id) throw new Error('Not authenticated');
      return scoreContract({ ...request, userId: user.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-scores'] });
    },
  });
}
