import React, { useState, useMemo, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { format, isSameDay } from "date-fns";
import { BaseModal } from "@/common/components/FEED/modals/BaseModal";
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery";

export type TradeOptionType = "trade" | "option";

/** Payload when submitting a stock trade entry */
export interface TradeEntryPayload {
  type: "trade";
  date: string; // YYYY-MM-DD
  ticker: string;
  pricePerShare: number;
  shares: number;
  estimatedCost: number;
}

/** Payload when submitting an option contract entry */
export interface OptionEntryPayload {
  type: "option";
  date: string;
  ticker: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expirationDate: string; // YYYY-MM-DD
  premiumPerContract: number;
  contracts: number;
  estimatedCost: number;
}

export type NewTradePayload = TradeEntryPayload | OptionEntryPayload;

interface NewTradeModalProps {
  visible: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  onSubmit: (payload: NewTradePayload) => void;
  isSubmitting?: boolean;
}

/**
 * Modal to add a new trade (stock) or option contract for a selected calendar date.
 * Toggle between Trade and Option; each form includes ticker and type-specific fields.
 * Estimated cost is computed from inputs.
 */
export const NewTradeModal: React.FC<NewTradeModalProps> = ({
  visible,
  onClose,
  selectedDate,
  onSubmit,
  isSubmitting = false,
}) => {
  const [mode, setMode] = useState<TradeOptionType>("trade");
  const [error, setError] = useState<string | null>(null);

  // Shared
  const [ticker, setTicker] = useState("");

  // Trade
  const [pricePerShare, setPricePerShare] = useState("");
  const [shares, setShares] = useState("");

  const tickerTrim = ticker.trim().toUpperCase();
  const isPresentDay = selectedDate ? isSameDay(selectedDate, new Date()) : false;
  const shouldFetchTickerPrice =
    visible && mode === "trade" && isPresentDay && tickerTrim.length > 3; //* Only fetches ticker info if more than 3 characters are inputted
  const queryTicker = shouldFetchTickerPrice ? tickerTrim : "";

  const { data: tickerResponse, isLoading: isTickerPriceLoading } =
    useTickerQuery(queryTicker);

  // Option
  const [optionType, setOptionType] = useState<"CALL" | "PUT">("CALL");
  const [strike, setStrike] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [premiumPerContract, setPremiumPerContract] = useState("");
  const [contracts, setContracts] = useState("1");

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  // Reset form when modal opens/closes or date changes
  useEffect(() => {
    if (visible) {
      setError(null);
      setTicker("");
      setPricePerShare("");
      setShares("");
      setOptionType("CALL");
      setStrike("");
      setExpirationDate("");
      setPremiumPerContract("");
      setContracts("1");
    }
  }, [visible, dateStr]);

  // Sync current price from ticker query into price-per-share when query runs for present day
  useEffect(() => {
    if (tickerResponse?.success && tickerResponse.data?.current_price != null) {
      const price = tickerResponse.data.current_price;
      if (typeof price === "number" && !Number.isNaN(price)) {
        setPricePerShare(price.toFixed(2));
      }
    }
  }, [tickerResponse]);

  // Trade: estimated cost = price * shares
  const tradeEstimatedCost = useMemo(() => {
    const p = parseFloat(pricePerShare);
    const s = parseFloat(shares);
    if (Number.isNaN(p) || Number.isNaN(s) || p <= 0 || s <= 0) return null;
    return p * s;
  }, [pricePerShare, shares]);

  // Option: estimated cost = premium * 100 * contracts
  const optionEstimatedCost = useMemo(() => {
    const prem = parseFloat(premiumPerContract);
    const qty = parseInt(contracts, 10);
    if (Number.isNaN(prem) || Number.isNaN(qty) || prem < 0 || qty <= 0) return null;
    return prem * 100 * qty;
  }, [premiumPerContract, contracts]);

  const handleSubmit = () => {
    setError(null);
    const tickerTrim = ticker.trim().toUpperCase();
    if (!tickerTrim) {
      setError("Enter a ticker symbol.");
      return;
    }
    if (!dateStr) {
      setError("No date selected.");
      return;
    }

    if (mode === "trade") {
      const p = parseFloat(pricePerShare);
      const s = parseFloat(shares);
      if (Number.isNaN(p) || p <= 0) {
        setError("Enter a valid price per share.");
        return;
      }
      if (Number.isNaN(s) || s <= 0 || s !== Math.floor(s)) {
        setError("Enter a valid whole number of shares.");
        return;
      }
      const estimatedCost = p * s;
      onSubmit({
        type: "trade",
        date: dateStr,
        ticker: tickerTrim,
        pricePerShare: p,
        shares: s,
        estimatedCost,
      });
      return;
    }

    // Option
    const strikeNum = parseFloat(strike);
    if (Number.isNaN(strikeNum) || strikeNum <= 0) {
      setError("Enter a valid strike price.");
      return;
    }
    const expTrim = expirationDate.trim();
    if (!expTrim || !/^\d{4}-\d{2}-\d{2}$/.test(expTrim)) {
      setError("Enter expiration date as YYYY-MM-DD.");
      return;
    }
    const prem = parseFloat(premiumPerContract);
    if (Number.isNaN(prem) || prem < 0) {
      setError("Enter a valid premium per contract.");
      return;
    }
    const qty = parseInt(contracts, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setError("Enter a valid number of contracts.");
      return;
    }
    const estimatedCost = prem * 100 * qty;
    onSubmit({
      type: "option",
      date: dateStr,
      ticker: tickerTrim,
      optionType,
      strike: strikeNum,
      expirationDate: expTrim,
      premiumPerContract: prem,
      contracts: qty,
      estimatedCost,
    });
  };

  const canSubmit =
    ticker.trim().length > 0 &&
    (mode === "trade"
      ? tradeEstimatedCost != null
      : optionEstimatedCost != null &&
        expirationDate.trim().length > 0 &&
        strike.trim().length > 0);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      onSubmit={handleSubmit}
      headerText="New Trade"
      submitButtonText="Add"
      submitButtonDisabled={!canSubmit || isSubmitting}
      isSubmitting={isSubmitting}
      enableKeyboardAvoiding
      maxContentHeight={120}
    >
      {selectedDate && (
        <Text className="text-gray-600 dark:text-gray-400 text-sm mb-4">
          Date: {format(selectedDate, "MMMM d, yyyy")}
        </Text>
      )}

      {/* Toggle: Trade | Option */}
      <View className="flex-row rounded-xl bg-gray-100 dark:bg-gray-800 p-1 mb-6">
        <TouchableOpacity
          onPress={() => setMode("trade")}
          className={`flex-1 py-3 rounded-lg items-center ${
            mode === "trade" ? "bg-white dark:bg-gray-700" : "bg-transparent"
          }`}
        >
          <Text
            className={`font-semibold ${mode === "trade" ? "text-black dark:text-white" : "text-gray-500"}`}
          >
            Trade
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode("option")}
          className={`flex-1 py-3 rounded-lg items-center ${
            mode === "option" ? "bg-white dark:bg-gray-700" : "bg-transparent"
          }`}
        >
          <Text
            className={`font-semibold ${mode === "option" ? "text-black dark:text-white" : "text-gray-500"}`}
          >
            Option
          </Text>
        </TouchableOpacity>
      </View>

      {/* Ticker (both) */}
      <View className="mb-4">
        <Text className="text-base font-semibold text-black dark:text-white mb-2">Ticker *</Text>
        <TextInput
          value={ticker}
          onChangeText={(t) => {
            setTicker(t);
            setError(null);
          }}
          placeholder="e.g. AAPL"
          placeholderTextColor="#6b7280"
          autoCapitalize="characters"
          autoCorrect={false}
          className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
          editable={!isSubmitting}
        />
      </View>

      {mode === "trade" ? (
        <>
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-semibold text-black dark:text-white">Price per share *</Text>
              {isTickerPriceLoading && (
                <View className="flex-row items-center">
                  <ActivityIndicator size="small" color="#9ca3af" />
                  <Text className="text-xs text-gray-600 dark:text-gray-400 ml-2">Fetching current price…</Text>
                </View>
              )}
            </View>
            <TextInput
              value={pricePerShare}
              onChangeText={(t) => {
                setPricePerShare(t);
                setError(null);
              }}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
          </View>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Shares *</Text>
            <TextInput
              value={shares}
              onChangeText={(t) => {
                setShares(t);
                setError(null);
              }}
              placeholder="0"
              keyboardType="number-pad"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
          </View>
          {tradeEstimatedCost != null && (
            <View className="mb-4 rounded-lg bg-gray-100/80 dark:bg-gray-800/80 p-4 border border-gray-200 dark:border-gray-700">
              <Text className="text-gray-600 dark:text-gray-400 text-sm mb-1">Estimated cost</Text>
              <Text className="text-black dark:text-white text-xl font-bold">
                ${tradeEstimatedCost.toFixed(2)}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Type</Text>
            <View className="flex-row rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 p-1">
              <TouchableOpacity
                onPress={() => setOptionType("CALL")}
                className={`flex-1 py-3 rounded-md items-center ${
                  optionType === "CALL" ? "bg-blue-600/30" : "bg-transparent"
                }`}
              >
                <Text
                  className={`font-semibold ${
                    optionType === "CALL" ? "text-blue-400" : "text-gray-500"
                  }`}
                >
                  Call
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setOptionType("PUT")}
                className={`flex-1 py-3 rounded-md items-center ${
                  optionType === "PUT" ? "bg-red-600/30" : "bg-transparent"
                }`}
              >
                <Text
                  className={`font-semibold ${
                    optionType === "PUT" ? "text-red-400" : "text-gray-500"
                  }`}
                >
                  Put
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Strike *</Text>
            <TextInput
              value={strike}
              onChangeText={(t) => {
                setStrike(t);
                setError(null);
              }}
              placeholder="e.g. 150.00"
              keyboardType="decimal-pad"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
          </View>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Expiration (YYYY-MM-DD) *</Text>
            <TextInput
              value={expirationDate}
              onChangeText={(t) => {
                setExpirationDate(t);
                setError(null);
              }}
              placeholder="2025-03-21"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
          </View>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Premium per contract *</Text>
            <TextInput
              value={premiumPerContract}
              onChangeText={(t) => {
                setPremiumPerContract(t);
                setError(null);
              }}
              placeholder="e.g. 2.50"
              keyboardType="decimal-pad"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
            <Text className="text-gray-500 text-xs mt-1">Price paid per contract ($)</Text>
          </View>
          <View className="mb-4">
            <Text className="text-base font-semibold text-black dark:text-white mb-2">Contracts *</Text>
            <TextInput
              value={contracts}
              onChangeText={(t) => {
                setContracts(t);
                setError(null);
              }}
              placeholder="1"
              keyboardType="number-pad"
              placeholderTextColor="#6b7280"
              className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 text-base text-black dark:text-white bg-gray-100 dark:bg-gray-800"
              editable={!isSubmitting}
            />
          </View>
          {optionEstimatedCost != null && (
            <View className="mb-4 rounded-lg bg-gray-100/80 dark:bg-gray-800/80 p-4 border border-gray-200 dark:border-gray-700">
              <Text className="text-gray-600 dark:text-gray-400 text-sm mb-1">Estimated cost (premium × 100 × contracts)</Text>
              <Text className="text-black dark:text-white text-xl font-bold">
                ${optionEstimatedCost.toFixed(2)}
              </Text>
            </View>
          )}
        </>
      )}

      {error ? (
        <View className="mb-4 bg-red-500/20 border border-red-500/50 rounded-lg p-3">
          <Text className="text-red-400 text-sm">{error}</Text>
        </View>
      ) : null}
    </BaseModal>
  );
};
