"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, Pressable, Modal, ScrollView } from "react-native"

interface SortOption {
  value: string
  label: string
}

interface SortDropdownProps {
  options: SortOption[]
  selectedValue: string
  onSelect: (value: string) => void
  placeholder?: string
}

export const SortDropdown: React.FC<SortDropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  placeholder = "Sort by",
}) => {
  const [isOpen, setIsOpen] = useState(false)

  const selectedOption = options.find((option) => option.value === selectedValue)

  const handleSelect = (value: string) => {
    onSelect(value)
    setIsOpen(false)
  }

  return (
    <>
      <Pressable
        onPress={() => setIsOpen(true)}
        className="bg-gray-800 px-4 py-2.5 rounded-xl flex-row items-center justify-between min-w-[120px] border border-gray-700"
      >
        <Text className="text-white font-medium text-sm">{selectedOption?.label || placeholder}</Text>
        <Text className="text-gray-400 ml-2 text-xs">▼</Text>
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center items-center" onPress={() => setIsOpen(false)}>
          <View className="bg-gray-900 rounded-2xl mx-8 max-w-xs w-full border border-gray-700">
            <View className="p-4 border-b border-gray-700">
              <Text className="text-white font-semibold text-center">Sort by</Text>
            </View>
            <ScrollView className="max-h-64">
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => handleSelect(option.value)}
                  className={`p-4 border-b border-gray-800 last:border-b-0 ${
                    selectedValue === option.value ? "bg-blue-600/20" : ""
                  }`}
                >
                  <Text
                    className={`text-center font-medium ${
                      selectedValue === option.value ? "text-blue-400" : "text-white"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}
