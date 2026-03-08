import type React from "react"
import { useState, useMemo, useCallback } from "react"
import { View, Text, SectionList, type ViewToken } from "react-native"
import { OptionsContractLine } from "./OptionsContractLine"
import { OptionsContractDetailModal } from "./OptionsContractDetailModal"
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker"

interface OptionsListProps {
  opportunities: OptionsOpportunity[]
  ticker: string
  currentPrice: number
  trackedContractSymbols?: Set<string>
  onTrackContract?: (contract: OptionsOpportunity) => void
  isTracking?: boolean
}

interface OptionsSection {
  title: string
  data: OptionsOpportunity[]
  currentPrice: number
}

export const OptionsList: React.FC<OptionsListProps> = ({
  opportunities,
  ticker,
  currentPrice,
  trackedContractSymbols = new Set(),
  onTrackContract,
  isTracking = false,
}) => {
  const [selectedContract, setSelectedContract] = useState<OptionsOpportunity | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [currentStickyTicker, setCurrentStickyTicker] = useState<string>(ticker)
  const [currentStickyPrice, setCurrentStickyPrice] = useState<number>(currentPrice)

  // Group opportunities by ticker
  const sections = useMemo(() => {
    const grouped = opportunities.reduce(
      (acc, contract) => {
        const key = ticker
        if (!acc[key]) {
          acc[key] = []
        }
        acc[key].push(contract)
        return acc
      },
      {} as Record<string, OptionsOpportunity[]>,
    )

    // Sort contracts by score (highest first)
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => b.total_score - a.total_score)
    })

    return Object.entries(grouped).map(([title, data]) => ({
      title,
      data,
      currentPrice,
    }))
  }, [opportunities, ticker, currentPrice])

  // Handle viewable items change to update sticky header
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const firstViewable = viewableItems[0]
        if (firstViewable.section) {
          const section = firstViewable.section as OptionsSection
          if (section.title !== currentStickyTicker) {
            setCurrentStickyTicker(section.title)
            setCurrentStickyPrice(section.currentPrice)
          }
        }
      }
    },
    [currentStickyTicker],
  )

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 100,
  }

  const handleContractPress = useCallback((contract: OptionsOpportunity) => {
    setSelectedContract(contract)
    setModalVisible(true)
  }, [])

  const handleTrackContract = useCallback(() => {
    if (selectedContract && onTrackContract) {
      onTrackContract(selectedContract)
      setModalVisible(false)
    }
  }, [selectedContract, onTrackContract])

  const renderSectionHeader = useCallback(
    ({ section }: { section: OptionsSection }) => (
      <View className="bg-gray-900 px-4 py-3 border-b border-gray-800">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="bg-blue-500/20 px-3 py-1.5 rounded-lg">
              <Text className="text-blue-400 font-bold text-lg">{section.title}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-gray-400 text-sm">Price:</Text>
              <Text className="text-white font-semibold text-base">${section.currentPrice.toFixed(2)}</Text>
            </View>
          </View>
          <Text className="text-gray-500 text-xs">
            {section.data.length} contract{section.data.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>
    ),
    [],
  )

  const renderContractLine = useCallback(
    ({ item }: { item: OptionsOpportunity }) => {
      const isTracked = trackedContractSymbols.has(item.contractSymbol)
      return <OptionsContractLine contract={item} isTracked={isTracked} onPress={() => handleContractPress(item)} />
    },
    [trackedContractSymbols, handleContractPress],
  )

  return (
    <View className="flex-1">
      {/* Sticky Ticker Header */}
      <View className="bg-gray-900 border-b border-gray-700 px-4 py-3">
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

      {/* Full-width SectionList */}
      <SectionList
        sections={sections}
        renderItem={renderContractLine}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item, index) => item.contractSymbol || `contract-${index}`}
        stickySectionHeadersEnabled={true}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      <OptionsContractDetailModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        contract={selectedContract}
        ticker={ticker}
        currentPrice={currentPrice}
        isTracked={selectedContract ? trackedContractSymbols.has(selectedContract.contractSymbol) : false}
        onTrackContract={handleTrackContract}
        isTracking={isTracking}
      />
    </View>
  )
}
