import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import { UserProfile, UserProfileUpdate } from '@/common/types/user/authModel';

/**
 * Updates a user's profile in Supabase
 * @param updateData - Partial profile data to update (must include id)
 * @returns Promise<UserProfile>
 */
const updateUserProfile = async (updateData: UserProfileUpdate): Promise<UserProfile> => {
  try {
    // Verify user has an active session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User not authenticated');
    }

    // Ensure the update data includes the user ID
    if (!updateData.id) {
      throw new Error('User ID is required for profile update');
    }

    // Update the profile in Supabase
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('id', updateData.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating user profile:', error);
      throw new Error(error.message || 'Failed to update user profile');
    }

    if (!data) {
      throw new Error('No data returned from profile update');
    }

    return data as UserProfile;
  } catch (error) {
    console.error('Error in updateUserProfile:', error);
    throw error;
  }
};

/**
 * Hook for updating user profile with React Query integration
 * Automatically invalidates and refetches profile queries on success
 * @returns Mutation object with mutate function and state
 */
export const useUpdateProfileMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUserProfile,
    
    onSuccess: (data, variables) => {
      console.log('Profile updated successfully:', data.id);
      
      // Update the profile query cache with the new data
      queryClient.setQueryData(
        ['profile', variables.id],
        data
      );
      
      // Invalidate profile queries to ensure consistency
      queryClient.invalidateQueries({
        queryKey: ['profile', variables.id],
      });
    },

    onError: (error: Error) => {
      console.error('Profile update failed:', error);
    },
  });
};

