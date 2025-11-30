import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useUpdateProfileMutation } from "@/hooks/mutations/auth/useUpdateProfileMutation";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import * as Haptics from "expo-haptics";
import type React from "react";
import { useState, useEffect } from "react";
import { Text, Pressable, Alert, View } from "react-native";
import { BaseModal } from "./BaseModal";
import { Ionicons } from "@expo/vector-icons";
 
interface SetMinimizedWatchlistProps {
  visible: boolean;
  onClose: () => void;
  onSubmit?: () => void;
  hasErrorOrNoData?: boolean;
  onRefresh?: () => void;
}

type MinimizedWatchlistType = "trending" | "gainers" | "most_active" | "favorites";

export const SetMinimizedWatchlistModal: React.FC<
  SetMinimizedWatchlistProps
> = ({ visible, onClose, onSubmit, hasErrorOrNoData = false, onRefresh }) => {
  const { authState: { user, profile } } = useAuth();
  const updateProfileMutation = useUpdateProfileMutation();
  
  // Initialize value from profile, default to "trending" if not set
  const [value, setValue] = useState<MinimizedWatchlistType>(
    (profile?.minimized_watchlist as MinimizedWatchlistType) || "trending"
  );

  // Update value when profile changes or modal becomes visible
  useEffect(() => {
    if (visible && profile?.minimized_watchlist) {
      setValue(profile.minimized_watchlist as MinimizedWatchlistType);
    }
  }, [visible, profile?.minimized_watchlist]);

  function onLabelPress(label: string) {
    return () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setValue(label as MinimizedWatchlistType);
    };
  }

  function onValueChange(newValue: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setValue(newValue as MinimizedWatchlistType);
  }

  const handleSubmit = async () => {
    // If there's an error or no data, refresh instead of saving
    // if (hasErrorOrNoData && onRefresh) {
    //   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    //   onRefresh();
    //   onClose();
    //   return;
    // }

    if (!user?.id) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    // Don't update if value hasn't changed
    if (profile?.minimized_watchlist === value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onClose();
      onSubmit?.();
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      await updateProfileMutation.mutateAsync({
        id: user.id,
        minimized_watchlist: value,
      });

      // Call optional onSubmit callback
      onSubmit?.();
      
      // Close modal after successful update
      onClose();
    } catch (error) {
      console.error("Failed to update watchlist preference:", error);
      Alert.alert(
        "Error",
        "Failed to save watchlist preference. Please try again."
      );
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      onSubmit={handleSubmit}
      headerText="Set Watchlist"
      submitButtonText={hasErrorOrNoData ? "Refresh" : "Save"}
      enableKeyboardAvoiding={false}
      isSubmitting={updateProfileMutation.isPending}
      submitButtonDisabled={updateProfileMutation.isPending}
    >
      {hasErrorOrNoData && (
        <View className="mb-4 p-4 bg-yellow-500/20 border border-yellow-500/40 rounded-lg">
          <View className="flex-row items-center mb-2">
            <Ionicons name="warning" size={20} color="#fbbf24" />
            <Text className="text-yellow-400 font-semibold text-base ml-2">
              Warning
            </Text>
          </View>
          <Text className="text-yellow-300 text-sm">
            {hasErrorOrNoData 
              ? "Unable to load watchlist data. Tap 'Refresh' to retry fetching the data."
              : "No data available for the selected watchlist."}
          </Text>
        </View>
      )}
      <RadioGroup value={value} onValueChange={onValueChange}>
        <Pressable
          className="flex flex-row items-center gap-3 mb-4"
          onPress={onLabelPress("trending")}>
          <RadioGroupItem
            value="trending"
            id="r1"
            className="border-white"
            indicatorClassName="bg-white"
          />
          <Text className="text-white text-base">Trending</Text>
        </Pressable>
        <Pressable
          className="flex flex-row items-center gap-3 mb-4"
          onPress={onLabelPress("gainers")}>
          <RadioGroupItem
            value="gainers"
            id="r2"
            className="border-white"
            indicatorClassName="bg-white"
          />
          <Text className="text-white text-base">Biggest Gainers</Text>
        </Pressable>
        <Pressable
          className="flex flex-row items-center gap-3"
          onPress={onLabelPress("most_active")}>
          <RadioGroupItem
            value="most_active"
            id="r3"
            className="border-white"
            indicatorClassName="bg-white"
          />
          <Text className="text-white text-base">Most Active</Text>
        </Pressable>
        <Pressable
          className="flex flex-row items-center gap-3"
          onPress={onLabelPress("favorites")}>
          <RadioGroupItem
            value="favorites"
            id="r4"
            className="border-white"
            indicatorClassName="bg-white"
          />
          <Text className="text-white text-base">Favorites</Text>
        </Pressable>
      </RadioGroup>
    </BaseModal>
  );
};
