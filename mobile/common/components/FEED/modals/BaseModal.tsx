import type React from "react"
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native"
import { BlurView } from "expo-blur"
import { Ionicons } from "@expo/vector-icons"

export interface BaseModalProps {
  visible: boolean
  onClose: () => void
  onSubmit?: () => void
  headerText: string
  showSubmitButton?: boolean
  submitButtonText?: string
  submitButtonDisabled?: boolean
  isSubmitting?: boolean
  children: React.ReactNode
  enableKeyboardAvoiding?: boolean
  maxContentHeight?: number
  closeButtonDisabled?: boolean
}

/**
 * BaseModal - A reusable modal component with consistent styling
 *
 * Features:
 * - BlurView backdrop with dark tint
 * - Consistent header with title and close button
 * - Scrollable content area
 * - Optional submit button with loading state
 * - KeyboardAvoidingView support for iOS
 * - Proper touch handling to prevent backdrop taps from closing when interacting with content
 *
 * @param visible - Controls modal visibility
 * @param onClose - Callback when modal should close
 * @param onSubmit - Optional callback for submit button
 * @param headerText - Text displayed in the header
 * @param showSubmitButton - Whether to show the submit button (default: true if onSubmit provided)
 * @param submitButtonText - Custom text for submit button (default: "Submit")
 * @param submitButtonDisabled - Whether submit button is disabled
 * @param isSubmitting - Whether submit is in progress (shows loading state)
 * @param children - Content to display in the scrollable area
 * @param enableKeyboardAvoiding - Enable KeyboardAvoidingView (default: true)
 * @param maxContentHeight - Max height for scrollable content (default: 96 = max-h-96)
 * @param closeButtonDisabled - Whether close button is disabled
 */
export const BaseModal: React.FC<BaseModalProps> = ({
  visible,
  onClose,
  onSubmit,
  headerText,
  showSubmitButton,
  submitButtonText = "Submit",
  submitButtonDisabled = false,
  isSubmitting = false,
  children,
  enableKeyboardAvoiding = true,
  maxContentHeight = 96,
  closeButtonDisabled = false,
}) => {
  // Determine if submit button should be shown
  const shouldShowSubmitButton = showSubmitButton ?? (onSubmit !== undefined)

  // Determine if submit button should be disabled
  const isSubmitDisabled = submitButtonDisabled || isSubmitting

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      <BlurView intensity={20} tint="dark" className="flex-1">
        <Pressable
          className="flex-1 bg-black/60 justify-center items-center px-6"
          onPress={onClose}
        >
          {enableKeyboardAvoiding ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 20}
              className="w-full max-w-md"
            >
              <ModalContent
                headerText={headerText}
                onClose={onClose}
                closeButtonDisabled={closeButtonDisabled || isSubmitting}
                shouldShowSubmitButton={shouldShowSubmitButton}
                submitButtonText={submitButtonText}
                isSubmitDisabled={isSubmitDisabled}
                isSubmitting={isSubmitting}
                onSubmit={onSubmit}
                maxContentHeight={maxContentHeight}
              >
                {children}
              </ModalContent>
            </KeyboardAvoidingView>
          ) : (
            <ModalContent
              headerText={headerText}
              onClose={onClose}
              closeButtonDisabled={closeButtonDisabled || isSubmitting}
              shouldShowSubmitButton={shouldShowSubmitButton}
              submitButtonText={submitButtonText}
              isSubmitDisabled={isSubmitDisabled}
              isSubmitting={isSubmitting}
              onSubmit={onSubmit}
              maxContentHeight={maxContentHeight}
            >
              {children}
            </ModalContent>
          )}
        </Pressable>
      </BlurView>
    </Modal>
  )
}

interface ModalContentProps {
  headerText: string
  onClose: () => void
  closeButtonDisabled: boolean
  shouldShowSubmitButton: boolean
  submitButtonText: string
  isSubmitDisabled: boolean
  isSubmitting: boolean
  onSubmit?: () => void
  maxContentHeight: number
  children: React.ReactNode
}

const ModalContent: React.FC<ModalContentProps> = ({
  headerText,
  onClose,
  closeButtonDisabled,
  shouldShowSubmitButton,
  submitButtonText,
  isSubmitDisabled,
  isSubmitting,
  onSubmit,
  maxContentHeight,
  children,
}) => {
  return (
    <Pressable
      className="w-full bg-gray-900/95 rounded-2xl overflow-hidden border border-gray-800"
      onPress={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <View className="bg-gray-900 pt-6 pb-4 px-6 border-b border-gray-800">
        <View className="flex-row justify-between items-center">
          <Text className="text-xl font-bold text-white">{headerText}</Text>
          <Pressable
            onPress={onClose}
            className="bg-gray-800 rounded-full p-2"
            disabled={closeButtonDisabled}
          >
            <Ionicons name="close" size={24} color="#9ca3af" />
          </Pressable>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={{ maxHeight: maxContentHeight * 4 }} // maxContentHeight in Tailwind units (96 = 384px)
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-6 py-6">{children}</View>
      </ScrollView>

      {/* Submit Button */}
      {shouldShowSubmitButton && onSubmit && (
        <View className="px-6 pb-6 pt-2">
          <TouchableOpacity
            onPress={onSubmit}
            disabled={isSubmitDisabled}
            className={`rounded-lg p-4 flex-row justify-center items-center ${
              isSubmitDisabled ? "bg-gray-700" : "bg-blue-500"
            }`}
          >
            {isSubmitting ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text className="text-white text-base font-semibold">Submitting...</Text>
              </View>
            ) : (
              <Text className="text-white text-base font-semibold">{submitButtonText}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </Pressable>
  )
}

