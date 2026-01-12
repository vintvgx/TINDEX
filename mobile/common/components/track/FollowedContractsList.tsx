import React, { useMemo, useState, useCallback, useRef } from "react"
import { View, Text, ActivityIndicator, Alert, ScrollView, NativeScrollEvent, NativeSyntheticEvent } from "react-native"
import { useUserORBFollows } from "@/hooks/mutations/ticker/tickerORB"
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery"
import { useTrackContract } from "@/hooks/mutations/track/useTrackContract"
import { useAuth } from "@/common/utils/context/auth/AuthContext"
import { useTrackedContracts } from "@/hooks/queries/track/useTrackedContracts"
import { OptionsContractLine } from "@/common/components/ticker/OptionsContractLine"
import { OptionsContractDetailModal } from "@/common/components/ticker/OptionsContractDetailModal"
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker"

export const FollowedContractsList: React.FC = () => {
  const { data: followedStocks = [], isLoading: isLoadingFollows } = useUserORBFollows()

  if (isLoadingFollows) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator size="large" color="#10B981" />
        <Text className="text-gray-400 mt-4">Loading followed stocks...</Text>
      </View>
    )
  }

  if (followedStocks.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-12">
        <Text className="text-gray-400 text-lg text-center mb-2">No followed stocks</Text>
        <Text className="text-gray-500 text-sm text-center">Follow stocks to see their options contracts here</Text>
      </View>
    )
  }

  // Render the list with all followed tickers
  return <FollowedStocksListContent tickers={followedStocks.map((f) => f.ticker)} />
}

interface FollowedStocksListContentProps {
  tickers: string[]
}

const FollowedStocksListContent: React.FC<FollowedStocksListContentProps> = ({ tickers }) => {
  const {
    authState: { user },
  } = useAuth()
  const { data: trackedContracts = [] } = useTrackedContracts()
  const trackContract = useTrackContract()

  const [selectedContract, setSelectedContract] = useState<OptionsOpportunity | null>(null)
  const [selectedTicker, setSelectedTicker] = useState<string>("")
  const [selectedCurrentPrice, setSelectedCurrentPrice] = useState<number>(0)
  const [modalVisible, setModalVisible] = useState(false)
  const [currentStickyTicker, setCurrentStickyTicker] = useState<string>("")
  const [currentStickyPrice, setCurrentStickyPrice] = useState<number>(0)

  const scrollViewRef = useRef<ScrollView>(null)
  const sectionRefs = useRef<Map<string, { y: number; price: number }>>(new Map())

  // Create a Set of tracked contract symbols for quick lookup
  const trackedContractSymbols = useMemo(() => {
    return new Set(trackedContracts.map((c) => c.contract_symbol))
  }, [trackedContracts])

  const handleContractPress = useCallback((contract: OptionsOpportunity, ticker: string, currentPrice: number) => {
    setSelectedContract(contract)
    setSelectedTicker(ticker)
    setSelectedCurrentPrice(currentPrice)
    setModalVisible(true)
  }, [])

  const handleTrackContract = async () => {
    if (!user?.id || !selectedContract) {
      Alert.alert("Error", "User not authenticated")
      return
    }

    try {
      const expirationDate = selectedContract.expirationDate
        ? new Date(selectedContract.expirationDate).toISOString().split("T")[0]
        : ""

      await trackContract.mutateAsync({
        userId: user.id,
        ticker: selectedTicker,
        contractSymbol: selectedContract.contractSymbol,
        optionType: selectedContract.optionType,
        strike: selectedContract.strike,
        expirationDate: expirationDate,
        trackingSnapshot: selectedContract,
        trackedFromSource: "followed_stock",
        initialAnalysisScore: selectedContract.total_score,
      })

      // Close modal first, then show alert after a brief delay to avoid navigation context issues
      setModalVisible(false)
      setTimeout(() => {
        Alert.alert("Success", `Contract ${selectedContract.contractSymbol} is now being tracked`)
      }, 100)
    } catch (error) {
      // Close modal first on error too
      setModalVisible(false)
      setTimeout(() => {
        Alert.alert("Error", error instanceof Error ? error.message : "Failed to track contract")
      }, 100)
    }
  }

  // Handle scroll to update sticky header
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollY = event.nativeEvent.contentOffset.y
    const stickyHeaderHeight = 60 // Approximate height of sticky header
    const threshold = scrollY + stickyHeaderHeight
    
    // Find which section is currently at the top (accounting for sticky header)
    // We want the section that is closest to but above the threshold
    let currentTicker = ""
    let currentPrice = 0
    let closestY = -Infinity
    
    sectionRefs.current.forEach((position, ticker) => {
      // If this section is above the threshold and is the closest one
      if (position.y <= threshold && position.y > closestY) {
        closestY = position.y
        currentTicker = ticker
        currentPrice = position.price
      }
    })

    // If we found a section, update the sticky header
    if (currentTicker && (currentTicker !== currentStickyTicker || Math.abs(currentPrice - currentStickyPrice) > 0.01)) {
      setCurrentStickyTicker(currentTicker)
      setCurrentStickyPrice(currentPrice)
    }
  }, [currentStickyTicker, currentStickyPrice])

  // Register section position
  const registerSectionPosition = useCallback((ticker: string, y: number, price: number) => {
    sectionRefs.current.set(ticker, { y, price })
    
    // Set initial sticky header if not set
    if (!currentStickyTicker && ticker) {
      setCurrentStickyTicker(ticker)
      setCurrentStickyPrice(price)
    }
  }, [currentStickyTicker])

  return (
    <View className="flex-1">
      {/* Sticky Ticker Header */}
      {currentStickyTicker && (
        <View className="bg-gray-900 border-b border-gray-700 px-4 py-3 z-10">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="bg-emerald-500/20 px-4 py-2 rounded-xl">
                <Text className="text-emerald-400 font-bold text-xl">{currentStickyTicker}</Text>
              </View>
              <View>
                <Text className="text-gray-500 text-xs">Current Price</Text>
                <Text className="text-white font-bold text-lg">${currentStickyPrice.toFixed(2)}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Scrollable Content */}
      <ScrollView
        ref={scrollViewRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        className="flex-1"
        showsVerticalScrollIndicator={true}
      >
        {/* Render each ticker's data */}
        {tickers.map((ticker) => (
          <TickerDataProvider
            key={ticker}
            ticker={ticker}
            trackedContractSymbols={trackedContractSymbols}
            onContractPress={handleContractPress}
            currentStickyTicker={currentStickyTicker}
            currentStickyPrice={currentStickyPrice}
            onRegisterPosition={registerSectionPosition}
          />
        ))}
      </ScrollView>

      {/* Modal */}
      <OptionsContractDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        contract={selectedContract}
        ticker={selectedTicker}
        currentPrice={selectedCurrentPrice}
        isTracked={selectedContract ? trackedContractSymbols.has(selectedContract.contractSymbol) : false}
        onTrackContract={handleTrackContract}
        isTracking={trackContract.isPending}
      />
    </View>
  )
}

interface TickerDataProviderProps {
  ticker: string
  trackedContractSymbols: Set<string>
  onContractPress: (contract: OptionsOpportunity, ticker: string, currentPrice: number) => void
  currentStickyTicker: string
  currentStickyPrice: number
  onRegisterPosition: (ticker: string, y: number, price: number) => void
}

// Separate component that can call hooks properly
const TickerDataProvider: React.FC<TickerDataProviderProps> = ({
  ticker,
  trackedContractSymbols,
  onContractPress,
  currentStickyTicker,
  currentStickyPrice,
  onRegisterPosition,
}) => {
  const { data: tickerData, isLoading } = useTickerQuery(ticker)
  const optionsData = tickerData?.data?.options_analysis
  const currentPrice = tickerData?.data?.current_price || 0
  const sectionRef = useRef<View>(null)

  // Register section position when layout is measured
  // onLayout gives us Y position relative to the ScrollView content
  const handleSectionLayout = useCallback((event: any) => {
    const { y } = event.nativeEvent.layout
    if (currentPrice > 0 && y >= 0) {
      onRegisterPosition(ticker, y, currentPrice)
    }
  }, [ticker, currentPrice, onRegisterPosition])

  // Check if this section's header should be hidden (matches sticky header)
  const shouldHideHeader = currentStickyTicker === ticker && 
    Math.abs(currentStickyPrice - currentPrice) < 0.01

  if (isLoading) {
    return (
      <View className="py-4 items-center">
        <ActivityIndicator size="small" color="#10B981" />
      </View>
    )
  }

  if (!optionsData?.has_opportunities || !optionsData?.opportunities?.length) {
    return (
      <View className="mx-4 mb-4 bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
        <Text className="text-gray-400 text-sm text-center">No options available for {ticker}</Text>
      </View>
    )
  }

  // Show top 5 contracts sorted by score
  const topContracts = optionsData.opportunities.sort((a, b) => b.total_score - a.total_score).slice(0, 5)

  return (
    <View ref={sectionRef} className="mb-2" onLayout={handleSectionLayout}>
      {/* Section Header - Hidden if matches sticky header */}
      {!shouldHideHeader && (
        <View className="bg-gray-900 px-4 py-3 border-b border-gray-800">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="bg-blue-500/20 px-3 py-1.5 rounded-lg">
                <Text className="text-blue-400 font-bold text-lg">{ticker}</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="text-gray-400 text-sm">Price:</Text>
                <Text className="text-white font-semibold text-base">${currentPrice.toFixed(2)}</Text>
              </View>
            </View>
            <Text className="text-gray-500 text-xs">
              {topContracts.length} contract{topContracts.length !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>
      )}

      {/* Contracts */}
      {topContracts.map((contract) => {
        const isTracked = trackedContractSymbols.has(contract.contractSymbol)
        return (
          <OptionsContractLine
            key={contract.contractSymbol}
            contract={contract}
            isTracked={isTracked}
            onPress={() => onContractPress(contract, ticker, currentPrice)}
          />
        )
      })}
    </View>
  )
}
