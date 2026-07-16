import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePortfolioPositionsQuery } from "@/hooks/queries/track/usePortfolioPositions";
import { useUpsertPortfolioPosition } from "@/hooks/mutations/portfolio/useUpsertPortfolioPosition";
import { useDeletePortfolioPosition } from "@/hooks/mutations/portfolio/useDeletePortfolioPosition";
import type { PortfolioPosition } from "@/common/types/portfolio";

interface PortfolioModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Modal content for portfolio positions: list + add form.
 * Fetches positions from Supabase; add/update (upsert) and delete with query invalidation.
 */
export function PortfolioModalContent({ visible, onClose }: PortfolioModalProps) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [averageCost, setAverageCost] = useState("");

  const { data: positions = [], isLoading, error, refetch } = usePortfolioPositionsQuery();
  const upsertMutation = useUpsertPortfolioPosition();
  const deleteMutation = useDeletePortfolioPosition();

  const handleSave = async () => {
    const tickerTrim = ticker.trim().toUpperCase();
    if (!tickerTrim) return;

    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(averageCost);
    if (Number.isNaN(sharesNum) || sharesNum <= 0) {
      return;
    }
    if (Number.isNaN(costNum) || costNum < 0) {
      return;
    }

    try {
      await upsertMutation.mutateAsync({
        ticker: tickerTrim,
        shares: sharesNum,
        average_cost: costNum,
      });
      setTicker("");
      setShares("");
      setAverageCost("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save position";
      Alert.alert("Error", message);
    }
  };

  const handleDelete = (position: PortfolioPosition) => {
    Alert.alert(
      "Remove position",
      `Remove ${position.ticker} from your portfolio?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteMutation.mutate(position.id),
        },
      ]
    );
  };

  const canSave =
    ticker.trim().length > 0 &&
    shares.trim().length > 0 &&
    averageCost.trim().length > 0 &&
    parseFloat(shares) > 0 &&
    parseFloat(averageCost) >= 0;

  return (
    <>
      <View className="pt-4 pb-4 px-6 border-b border-gray-200 dark:border-gray-800 flex-row items-center justify-between">
        <Text className="text-black dark:text-white text-2xl font-bold">Portfolio</Text>
        <TouchableOpacity onPress={onClose} className="p-2">
          <Ionicons name="close" size={24} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {/* Add position form */}
        <View className="mb-6">
          <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-3">Add position</Text>
          <View className="bg-gray-100/80 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <View className="mb-3">
              <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Ticker</Text>
              <TextInput
                value={ticker}
                onChangeText={setTicker}
                placeholder="e.g. AAPL"
                placeholderTextColor="#6b7280"
                autoCapitalize="characters"
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-3 text-black dark:text-white text-base"
              />
            </View>
            <View className="mb-3">
              <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Shares</Text>
              <TextInput
                value={shares}
                onChangeText={setShares}
                placeholder="0 or 0.5"
                placeholderTextColor="#6b7280"
                keyboardType="decimal-pad"
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-3 text-black dark:text-white text-base"
              />
            </View>
            <View className="mb-4">
              <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Average cost ($)</Text>
              <TextInput
                value={averageCost}
                onChangeText={setAverageCost}
                placeholder="0.00"
                placeholderTextColor="#6b7280"
                keyboardType="decimal-pad"
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-3 text-black dark:text-white text-base"
              />
            </View>
            <TouchableOpacity
              onPress={handleSave}
              disabled={!canSave || upsertMutation.isPending}
              className={`rounded-lg py-3 items-center ${
                canSave && !upsertMutation.isPending ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-700"
              }`}
            >
              {upsertMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white font-semibold">Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* List */}
        <View>
          <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-3">Your positions</Text>
          {isLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator size="large" color="#10B981" />
              <Text className="text-gray-600 dark:text-gray-400 mt-2">Loading portfolio…</Text>
            </View>
          ) : error ? (
            <View className="py-6 rounded-xl bg-red-500/10 border border-red-500/30 px-4">
              <Text className="text-red-600 dark:text-red-400 text-sm">
                {error instanceof Error ? error.message : "Failed to load portfolio"}
              </Text>
              <TouchableOpacity onPress={() => refetch()} className="mt-2">
                <Text className="text-blue-600 dark:text-blue-400 text-sm">Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : positions.length === 0 ? (
            <View className="py-8 rounded-xl bg-gray-100/80 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
              <Text className="text-gray-500 text-center">No positions yet. Add one above.</Text>
            </View>
          ) : (
            <View className="gap-2">
              {positions.map((pos) => (
                <View
                  key={pos.id}
                  className="flex-row items-center justify-between bg-gray-100/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3"
                >
                  <View className="flex-1">
                    <Text className="text-black dark:text-white font-semibold">{pos.ticker}</Text>
                    <Text className="text-gray-600 dark:text-gray-400 text-sm">
                      {Number(pos.shares)} shares @ ${Number(pos.average_cost).toFixed(2)} avg
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(pos)}
                    disabled={deleteMutation.isPending}
                    className="p-2"
                  >
                    <Ionicons name="trash-outline" size={22} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}
