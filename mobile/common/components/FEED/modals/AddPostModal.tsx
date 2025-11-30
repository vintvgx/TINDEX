"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, TextInput, Alert } from "react-native"
import type { CategoryType } from "@/lib/categories"
import { useGenerateBlogPostMutation } from "@/hooks/mutations/blogs/createBlogPostMutation"
import { useAuth } from "@/common/utils/context/auth/AuthContext"
import { type GenerateBlogPostRequest, PRIORITY_TYPE } from "@/common/types/blogPosts/create"
import { BaseModal } from "./BaseModal"

interface AddPostModalProps {
  visible: boolean
  onClose: () => void
  onSubmit: () => void
}

const TICKER_REGEX = /^[A-Z]{1,5}$/

export const AddPostModal: React.FC<AddPostModalProps> = ({ visible, onClose, onSubmit }) => {
  const [tickerName, setTickerName] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<CategoryType | "">("")
  // const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tickerError, setTickerError] = useState("")

  // Hooks
  const {
    authState: { user },
  } = useAuth()

  const {
    mutateAsync: generateBlogPost,
    isPending: blogPostPending,
  } = useGenerateBlogPostMutation()

  const validateTicker = (ticker: string): boolean => {
    if (!ticker.trim()) {
      setTickerError("Ticker symbol is required")
      return false
    }

    if (!TICKER_REGEX.test(ticker.trim())) {
      setTickerError("Ticker must be 1-5 uppercase letters (e.g., AAPL, TSLA)")
      return false
    }

    setTickerError("")
    return true
  }

  const handleTickerChange = (text: string) => {
    const upperText = text.toUpperCase()
    setTickerName(upperText)

    // Clear error when user starts typing
    if (tickerError) {
      setTickerError("")
    }
  }

  const handleSubmit = async () => {
    if (!validateTicker(tickerName)) {
      return
    }

    if (!user?.id) {
      Alert.alert("Error", "User not authenticated. Please log in again.")
      return
    }

    setIsSubmitting(true)
    try {
      // Create the blog generation request
      const request: GenerateBlogPostRequest = {
        userId: user.id,
        ticker: tickerName.trim(),
        categoryName: selectedCategory,
        targetLength: 700,
        priority: PRIORITY_TYPE.NORMAL,
      }

      // Call the blog generation mutation
      const result = await generateBlogPost(request)

      if (result.success) {
        // Call onSubmit to re-fetch feed data
        await onSubmit()

        Alert.alert(
          "Success",
          `Blog post generation started! Job ID: ${result.jobId}\n\nYour post will be available shortly.`,
        )

        handleClose()
      } else {
        Alert.alert("Error", result.message || "Failed to generate blog post.")
      }
    } catch (error: any) {
      console.error("Blog post generation error:", error)

      // Handle specific error types
      if (error?.code === "UNAUTHORIZED") {
        Alert.alert("Authentication Error", "Please log in again to create posts.")
      } else if (error?.code === "GENERATION_FAILED") {
        Alert.alert("Generation Failed", "Failed to generate blog post. Please try again later.")
      } else if (error?.code === "NETWORK_ERROR") {
        Alert.alert("Network Error", "Please check your internet connection and try again.")
      } else {
        Alert.alert("Error", "An unexpected error occurred. Please try again.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setTickerName("")
    setSelectedCategory("")
    setIsSubmitting(false)
    setTickerError("")
    onClose()
  }

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      onSubmit={handleSubmit}
      headerText="Generate Blog Post"
      submitButtonText="Generate Blog Post"
      submitButtonDisabled={isSubmitting || blogPostPending || !tickerName.trim() || !!tickerError}
      isSubmitting={isSubmitting || blogPostPending}
      enableKeyboardAvoiding={true}
    >
      <View className="mb-6">
        <Text className="text-base font-semibold text-white mb-3">Ticker Symbol *</Text>
        <TextInput
          value={tickerName}
          onChangeText={handleTickerChange}
          placeholder="e.g., AAPL, TSLA, NVDA"
          maxLength={5}
          autoCapitalize="characters"
          className={`border rounded-lg p-4 text-base text-white bg-gray-800 ${
            tickerError ? "border-red-500" : "border-gray-700"
          }`}
          placeholderTextColor="#6b7280"
          editable={!isSubmitting}
        />
        {tickerError ? (
          <Text className="text-sm text-red-400 mt-2">{tickerError}</Text>
        ) : (
          <Text className="text-sm text-gray-500 mt-2">Enter 1-5 uppercase letters</Text>
        )}
      </View>

      {/* <View className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <Text className="text-sm text-gray-400 leading-5">
          <Text className="font-semibold text-gray-300">Tip:</Text> Enter a valid stock ticker symbol (1-5
          uppercase letters). Our AI will generate comprehensive content based on your ticker and selected
          category.
        </Text>
      </View> */}
    </BaseModal>
  )
}
