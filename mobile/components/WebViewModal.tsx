import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

interface WebViewModalProps {
  visible: boolean;
  onClose: () => void;
  url: string;
  title?: string;
}

export const WebViewModal: React.FC<WebViewModalProps> = ({
  visible,
  onClose,
  url,
  title = "Article",
}) => {
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [webViewRef, setWebViewRef] = useState<WebView | null>(null);

  const handleLoadStart = () => {
    setLoading(true);
  };

  const handleLoadEnd = () => {
    setLoading(false);
  };

  const handleNavigationStateChange = (navState: any) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
  };

  const handleGoBack = () => {
    if (webViewRef && canGoBack) {
      webViewRef.goBack();
    }
  };

  const handleGoForward = () => {
    if (webViewRef && canGoForward) {
      webViewRef.goForward();
    }
  };

  const handleRefresh = () => {
    if (webViewRef) {
      webViewRef.reload();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      {/* Header */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-white pt-12 pb-4 px-4 border-b border-gray-200">
        <View className="flex-row justify-between items-center">
          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            className="bg-gray-100 rounded-full p-2 ml-2">
            <Ionicons name="close" size={20} color="#374151" />
          </Pressable>
        </View>

        {/* Navigation Controls */}
        <View className="flex-row items-center justify-between mt-3">
          <View className="flex-row space-x-2">
            <Pressable
              onPress={handleGoBack}
              disabled={!canGoBack}
              className={`p-2 rounded-full ${
                canGoBack ? "bg-gray-100" : "bg-gray-50"
              }`}>
              <Ionicons
                name="arrow-back"
                size={18}
                color={canGoBack ? "#374151" : "#9CA3AF"}
              />
            </Pressable>
            <Pressable
              onPress={handleGoForward}
              disabled={!canGoForward}
              className={`p-2 rounded-full ${
                canGoForward ? "bg-gray-100" : "bg-gray-50"
              }`}>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={canGoForward ? "#374151" : "#9CA3AF"}
              />
            </Pressable>
            <Pressable
              onPress={handleRefresh}
              className="p-2 rounded-full bg-gray-100">
              <Ionicons name="refresh" size={18} color="#374151" />
            </Pressable>
          </View>

          <View className="flex-row items-center">
            {loading && (
              <View className="flex-row items-center mr-2">
                <ActivityIndicator size="small" color="#3B82F6" />
                <Text className="text-xs text-gray-500 ml-1">Loading...</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* WebView */}
      <View className="flex-1 pt-32">
        <WebView
          ref={setWebViewRef}
          source={{ uri: url }}
          onLoadStart={handleLoadStart}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={handleNavigationStateChange}
          startInLoadingState={true}
          renderLoading={() => (
            <View className="flex-1 justify-center items-center">
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text className="text-gray-500 mt-2">Loading article...</Text>
            </View>
          )}
          // Enable JavaScript and other features
          javaScriptEnabled={true}
          domStorageEnabled={true}
          // Handle external links
          onShouldStartLoadWithRequest={(request) => {
            // Allow navigation within the same domain
            return true;
          }}
          // Error handling
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('WebView error: ', nativeEvent);
          }}
          // Custom user agent to avoid some mobile detection issues
          userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"
        />
      </View>
    </Modal>
  );
}; 