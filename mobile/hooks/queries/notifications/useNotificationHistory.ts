import { NotificationRecord } from "@/common/types/notifications/notificationModel";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";


export function useNotificationHistory() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  // Fetch notifications
  const notificationsQuery = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async (): Promise<NotificationRecord[]> => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error retrieving notifications:", error);
        throw error;
      }

      return data || [];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq("id", notificationId)
        .eq("user_id", user?.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      
      const { error } = await supabase
        .from("notifications")
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });

  // Get unread count
  const unreadCount = notificationsQuery.data?.filter(n => !n.is_read).length || 0;

  return {
    notifications: notificationsQuery.data || [],
    isLoading: notificationsQuery.isLoading,
    error: notificationsQuery.error,
    refetch: notificationsQuery.refetch,
    markAsRead: markAsReadMutation.mutate,
    markAllAsRead: markAllAsReadMutation.mutate,
    unreadCount,
  };
}