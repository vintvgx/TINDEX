import React, { useState } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CATEGORIES } from "@/lib/categories";
import { CategoryType } from "@/lib/categories";
import { useGenerateBlogPostMutation } from "@/hooks/mutations/blogs/createBlogPostMutation";
import { useAuth } from "@/context/auth/AuthContext";
import {
  GenerateBlogPostRequest,
  PRIORITY_TYPE,
} from "@/types/blogPosts/create";

interface AddPostModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export const AddPostModal: React.FC<AddPostModalProps> = ({
  visible,
  onClose,
  onSubmit,
}) => {
  const [content, setContent] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryType | "">(
    ""
  );
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hooks
  const {
    authState: { user },
  } = useAuth();

  const {mutateAsync: generateBlogPost, isPending: blogPostPending, isError: blogPostError} = useGenerateBlogPostMutation()

  const handleSubmit = async () => {
    if (!content.trim()) {
      Alert.alert("Error", "Please enter some content for your post.");
      return;
    }

    if (!selectedCategory) {
      Alert.alert("Error", "Please select a category.");
      return;
    }

    if (!user?.id) {
      Alert.alert("Error", "User not authenticated. Please log in again.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Create the blog generation request
      const request: GenerateBlogPostRequest = {
        userId: user.id,
        topicName: content.trim(), // Using content as topicName as per TODO comment
        categoryName: selectedCategory,
        targetLength: 700,
        priority: PRIORITY_TYPE.NORMAL,
      };

      // Call the blog generation mutation
      const result = await generateBlogPost(request);

      if (result.success) {
        // Call onSubmit to re-fetch feed data
        await onSubmit();

        Alert.alert(
          "Success",
          `Blog post generation started! Job ID: ${result.jobId}\n\nYour post will be available shortly.`
        );

        handleClose();
      } else {
        Alert.alert("Error", result.message || "Failed to generate blog post.");
      }
    } catch (error: any) {
      console.error("Blog post generation error:", error);

      // Handle specific error types
      if (error?.code === "UNAUTHORIZED") {
        Alert.alert(
          "Authentication Error",
          "Please log in again to create posts."
        );
      } else if (error?.code === "GENERATION_FAILED") {
        Alert.alert(
          "Generation Failed",
          "Failed to generate blog post. Please try again later."
        );
      } else if (error?.code === "NETWORK_ERROR") {
        Alert.alert(
          "Network Error",
          "Please check your internet connection and try again."
        );
      } else {
        Alert.alert("Error", "An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setContent("");
    setSelectedCategory("");
    setShowCategoryDropdown(false);
    setIsSubmitting(false);
    onClose();
  };

  const handleCategorySelect = (category: CategoryType) => {
    setSelectedCategory(category);
    setShowCategoryDropdown(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      {/* Header */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-white pt-12 pb-4 px-4 border-b border-gray-200">
        <View className="flex-row justify-between items-center">
          <Text className="text-xl font-bold text-gray-900">
            Generate Blog Post
          </Text>
          <Pressable
            onPress={handleClose}
            className="bg-gray-100 rounded-full p-2"
            disabled={isSubmitting}>
            <Ionicons name="close" size={24} color="#374151" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1 bg-white pt-20"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View className="px-6 py-6">
          {/* Category Selection */}
          <View className="mb-6">
            <Text className="text-base font-semibold text-gray-900 mb-3">
              Category *
            </Text>
            <TouchableOpacity
              onPress={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className={`border rounded-lg p-4 flex-row justify-between items-center ${
                selectedCategory
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300"
              }`}
              disabled={isSubmitting}>
              <Text
                className={`text-base ${selectedCategory ? "text-blue-900" : "text-gray-500"}`}>
                {selectedCategory || "Select a category"}
              </Text>
              <Ionicons
                name={showCategoryDropdown ? "chevron-up" : "chevron-down"}
                size={20}
                color={selectedCategory ? "#1e40af" : "#6b7280"}
              />
            </TouchableOpacity>

            {/* Category Dropdown */}
            {showCategoryDropdown && (
              <View className="mt-2 border border-gray-200 rounded-lg bg-white shadow-lg max-h-48">
                <ScrollView showsVerticalScrollIndicator={false}>
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      onPress={() => handleCategorySelect(category)}
                      className="p-4 border-b border-gray-100 active:bg-gray-50">
                      <Text className="text-base text-gray-900">
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Content Input */}
          <View className="mb-6">
            <Text className="text-base font-semibold text-gray-900 mb-3">
              Topic/Title *
            </Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="Enter a topic or title for your blog post..."
              multiline
              textAlignVertical="top"
              className="border border-gray-300 rounded-lg p-4 min-h-32 text-base text-gray-900"
              placeholderTextColor="#9ca3af"
              editable={!isSubmitting}
            />
            <Text className="text-sm text-gray-500 mt-2">
              {content.length} characters
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={
              isSubmitting ||
              blogPostPending ||
              !content.trim() ||
              !selectedCategory
            }
            className={`rounded-lg p-4 flex-row justify-center items-center ${
              isSubmitting ||
              blogPostPending ||
              !content.trim() ||
              !selectedCategory
                ? "bg-gray-300"
                : "bg-blue-500"
            }`}>
            {isSubmitting || blogPostPending ? (
              <View className="flex-row items-center">
                <ActivityIndicator
                  size="small"
                  color="#ffffff"
                  style={{ marginRight: 8 }}
                />
                <Text className="text-white text-base font-semibold">
                  Creating...
                </Text>
              </View>
            ) : (
              <Text className="text-white text-base font-semibold">
                Generate Blog Post
              </Text>
            )}
          </TouchableOpacity>

          {/* Help Text */}
          <View className="mt-6 p-4 bg-gray-50 rounded-lg">
            <Text className="text-sm text-gray-600 leading-5">
              <Text className="font-semibold">Tip:</Text> Write a clear topic or
              title for your blog post. Our AI will generate comprehensive
              content based on your topic and selected category. The generation
              process may take a few moments.
            </Text>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};
