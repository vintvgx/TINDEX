"use client";
/**
 * The info header section displayed within [ticker].tsx
 */

import type React from "react";
import { View, Text, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TickerData } from "@/common/types/blogPosts/ticker";

interface StockInfoHeaderProps {
  stockData: TickerData;
}

export const StockInfoHeader: React.FC<StockInfoHeaderProps> = ({ stockData }) => {
  return (
    <View className="flex-row items-center mb-6">
      <View className="flex-1">
        <View className="flex-row items-center mb-2">
          {/* Company Logo */}
          {stockData.logo_url && (
            <View className="w-8 h-8 rounded-lg bg-gray-800/50 mr-3 border border-gray-700/30 overflow-hidden">
              <Image
                source={{ uri: stockData.logo_url }}
                className="w-full h-full"
                resizeMode="contain"
              />
            </View>
          )}
          
          {/* Company Name */}
          {stockData.company_name && (
            <Text className="text-gray-400 text-sm font-medium">
              {stockData.company_name}
            </Text>
          )}
        </View>
        
        {/* Ticker Symbol */}
        {stockData.ticker && (
          <Text className="text-white text-3xl font-black tracking-tight mt-1">
            {stockData.ticker}
          </Text>
        )}
        
        {/* Sector */}
        {stockData.sector && (
          <Text className="text-gray-400 text-sm font-medium mt-1">
            {stockData.sector}
          </Text>
        )}
      </View>
      
      {/* Price Information */}
      <View className="items-end">
        {/* Current Price */}
        {stockData.current_price && (
          <Text className="text-white text-3xl font-black tracking-tight">
            ${stockData.current_price.toFixed(2)} {stockData.currency || 'USD'}
          </Text>
        )}
        
        {/* Price Change */}
        {stockData.price_change !== undefined && stockData.price_change_percent !== undefined && (
          <View className="flex-row items-center mt-1">
            <Ionicons
              name={stockData.price_change >= 0 ? "triangle" : "triangle"}
              size={12}
              color={stockData.price_change >= 0 ? "#22C55E" : "#EF4444"}
              style={{
                transform: [
                  { rotate: stockData.price_change >= 0 ? "0deg" : "180deg" },
                ],
              }}
            />
            <Text
              className={`ml-2 font-bold tracking-wide ${
                stockData.price_change >= 0
                  ? "text-green-400"
                  : "text-red-400"
              }`}>
              {stockData.price_change >= 0 ? "+" : ""}
              {stockData.price_change.toFixed(2)} (
              {stockData.price_change_percent.toFixed(2)}%)
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};
