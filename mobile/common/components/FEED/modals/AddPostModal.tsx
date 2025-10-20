"use client"

import type React from "react"
import { useState } from "react"
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StatusBar,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native"
import { BlurView } from "expo-blur"
import { Ionicons } from "@expo/vector-icons"
import { CATEGORIES } from "@/lib/categories"
import type { CategoryType } from "@/lib/categories"
import { useGenerateBlogPostMutation } from "@/hooks/mutations/blogs/createBlogPostMutation"
import { useAuth } from "@/common/utils/context/auth/AuthContext"
import { type GenerateBlogPostRequest, PRIORITY_TYPE } from "@/common/types/blogPosts/create"

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
    isError: blogPostError,
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
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={handleClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      <BlurView intensity={20} tint="dark" className="flex-1">
        <Pressable className="flex-1 bg-black/60 justify-center items-center px-6" onPress={handleClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 20}
            className="w-full max-w-md"
          >
            <Pressable
              className="w-full bg-gray-900/95 rounded-2xl overflow-hidden border border-gray-800"
              onPress={(e) => e.stopPropagation()}
            >
            <View className="bg-gray-900 pt-6 pb-4 px-6 border-b border-gray-800">
              <View className="flex-row justify-between items-center">
                <Text className="text-xl font-bold text-white">Generate Blog Post</Text>
                <Pressable onPress={handleClose} className="bg-gray-800 rounded-full p-2" disabled={isSubmitting}>
                  <Ionicons name="close" size={24} color="#9ca3af" />
                </Pressable>
              </View>
            </View>

            <ScrollView className="max-h-96" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View className="px-6 py-6">
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


                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={isSubmitting || blogPostPending || !tickerName.trim() || !!tickerError}
                  className={`rounded-lg p-4 flex-row justify-center items-center ${
                    isSubmitting || blogPostPending || !tickerName.trim() || !!tickerError
                      ? "bg-gray-700"
                      : "bg-blue-500"
                  }`}
                >
                  {isSubmitting || blogPostPending ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                      <Text className="text-white text-base font-semibold">Creating...</Text>
                    </View>
                  ) : (
                    <Text className="text-white text-base font-semibold">Generate Blog Post</Text>
                  )}
                </TouchableOpacity>

                {/* <View className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <Text className="text-sm text-gray-400 leading-5">
                    <Text className="font-semibold text-gray-300">Tip:</Text> Enter a valid stock ticker symbol (1-5
                    uppercase letters). Our AI will generate comprehensive content based on your ticker and selected
                    category.
                  </Text>
                </View> */}
              </View>
            </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </BlurView>
    </Modal>
  )
}
