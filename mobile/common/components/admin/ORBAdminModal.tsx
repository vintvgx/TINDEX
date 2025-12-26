import React, { useEffect } from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { useStartORBMutation, useStopORBMutation } from '@/hooks/mutations/orb/useORBControl';

/**
 * Simple toast function using Alert (can be replaced with proper toast implementation)
 */
const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
  const title = type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Info';
  Alert.alert(title, message);
};

interface ORBAdminModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * ORB Admin Modal Component
 * 
 * Displays ORB monitoring service status and provides controls to start/stop the service
 * 
 * Features:
 * - Real-time status display with visual indicators (green/red lights)
 * - Start/Stop service controls
 * - Service metrics (active tickers, calculation phase, etc.)
 * - Auto-refreshes status every 10 seconds
 */
export const ORBAdminModal: React.FC<ORBAdminModalProps> = ({
  visible,
  onClose,
}) => {
  const { data: status, isLoading, error } = useORBStatus();
  const startMutation = useStartORBMutation();
  const stopMutation = useStopORBMutation();

  const isRunning = status?.running ?? false;
  const isCalculationPhase = status?.calculation_phase ?? false;
  const activeTickers = status?.active_tickers ?? [];
  const orbRangesCount = status?.orb_ranges_count ?? 0;

  const handleStart = () => {
    startMutation.mutate(true);
  };

  const handleStop = () => {
    stopMutation.mutate();
  };

  const isLoadingAction = startMutation.isPending || stopMutation.isPending;

  // Show toast notifications for mutation results
  useEffect(() => {
    if (startMutation.isSuccess) {
      showToast('ORB monitoring service started successfully', 'success');
    }
  }, [startMutation.isSuccess]);

  useEffect(() => {
    if (startMutation.isError) {
      const errorMessage = startMutation.error instanceof Error 
        ? startMutation.error.message 
        : 'Failed to start ORB service';
      showToast(errorMessage, 'error');
    }
  }, [startMutation.isError, startMutation.error]);

  useEffect(() => {
    if (stopMutation.isSuccess) {
      showToast('ORB monitoring service stopped successfully', 'success');
    }
  }, [stopMutation.isSuccess]);

  useEffect(() => {
    if (stopMutation.isError) {
      const errorMessage = stopMutation.error instanceof Error 
        ? stopMutation.error.message 
        : 'Failed to stop ORB service';
      showToast(errorMessage, 'error');
    }
  }, [stopMutation.isError, stopMutation.error]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Header */}
      <View className="bg-white pt-12 pb-4 px-6 border-b border-gray-200">
        <View className="flex-row justify-between items-center">
          <Text className="text-2xl font-bold text-gray-900">ORB Admin</Text>
          <Pressable
            onPress={onClose}
            className="bg-gray-100 rounded-full p-2">
            <Ionicons name="close" size={24} color="#374151" />
          </Pressable>
        </View>
      </View>

      {/* Content */}
      <ScrollView className="flex-1 bg-white" showsVerticalScrollIndicator={false}>
        <View className="px-6 py-6">
          {/* Status Section */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Service Status</Text>
            
            {isLoading && (
              <View className="items-center py-4">
                <ActivityIndicator size="large" color="#3b82f6" />
                <Text className="text-gray-500 mt-2">Loading status...</Text>
              </View>
            )}

            {error && (
              <View className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <Text className="text-red-800 font-medium">Error loading status</Text>
                <Text className="text-red-600 text-sm mt-1">
                  {error instanceof Error ? error.message : 'Unknown error'}
                </Text>
              </View>
            )}

            {!isLoading && !error && (
              <View>
                {/* Status Indicator Row */}
                <View className="flex-row items-center gap-4">
                  {/* Status Light */}
                  <View className={`w-4 h-4 rounded-full ${isRunning ? 'bg-green-500' : 'bg-red-500'}`} />
                  
                  <View className="flex-1">
                    <Text className="text-base font-medium text-gray-900">
                      {isRunning ? 'Service Running' : 'Service Stopped'}
                    </Text>
                    {isCalculationPhase && (
                      <Text className="text-sm text-blue-600 mt-1">
                        Currently in calculation phase (9:30-9:45 AM)
                      </Text>
                    )}
                  </View>
                </View>

                {/* Metrics */}
                {isRunning && (
                  <View className="bg-gray-50 rounded-lg p-4 mt-4 gap-2">
                    <View className="flex-row justify-between">
                      <Text className="text-gray-600">Active Tickers:</Text>
                      <Text className="text-gray-900 font-semibold">{activeTickers.length}</Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text className="text-gray-600">ORB Ranges:</Text>
                      <Text className="text-gray-900 font-semibold">{orbRangesCount}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Monitored Tickers List */}
          {!isLoading && !error && (
            <View className="mb-6">
              <Text className="text-lg font-semibold text-gray-900 mb-4">Monitored Tickers</Text>
              
              {activeTickers.length > 0 ? (
                <View className="bg-gray-50 rounded-lg p-4">
                  <ScrollView 
                    className="max-h-48"
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}>
                    <View className="gap-2">
                      {activeTickers.map((ticker, index) => (
                        <View 
                          key={ticker}
                          className={`flex-row items-center justify-between py-2 px-3 bg-white rounded-lg ${
                            index < activeTickers.length - 1 ? 'mb-1' : ''
                          }`}>
                          <View className="flex-row items-center gap-3">
                            <View className="w-8 h-8 bg-blue-100 rounded-full items-center justify-center">
                              <Text className="text-blue-600 font-bold text-xs">
                                {ticker.charAt(0)}
                              </Text>
                            </View>
                            <Text className="text-gray-900 font-semibold text-base">
                              {ticker}
                            </Text>
                          </View>
                          <View className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500' : 'bg-gray-400'}`} />
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              ) : (
                <View className="bg-gray-50 rounded-lg p-6 items-center">
                  <Ionicons name="list-outline" size={48} color="#9ca3af" />
                  <Text className="text-gray-500 text-center mt-3">
                    No tickers being monitored
                  </Text>
                  <Text className="text-gray-400 text-sm text-center mt-1">
                    Tickers will appear here once the service is running
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Control Section */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Service Controls</Text>
            
            {isRunning ? (
              <View className="gap-3">
                <TouchableOpacity
                  onPress={handleStop}
                  disabled={isLoadingAction}
                  className={`w-full h-14 rounded-md bg-red-600 items-center justify-center ${
                    isLoadingAction ? 'opacity-50' : 'active:opacity-90'
                  }`}>
                  {stopMutation.isPending ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text className="text-white ml-2">Stopping...</Text>
                    </View>
                  ) : (
                    <Text className="text-white font-semibold text-lg">Stop Service</Text>
                  )}
                </TouchableOpacity>
                
                <View className="flex-row items-center justify-center gap-2">
                  <View className="w-3 h-3 rounded-full bg-green-500" />
                  <Text className="text-gray-600 text-sm">Service is active</Text>
                </View>
              </View>
            ) : (
              <View className="gap-3">
                <TouchableOpacity
                  onPress={handleStart}
                  disabled={isLoadingAction}
                  className={`w-full h-14 rounded-md bg-green-600 items-center justify-center ${
                    isLoadingAction ? 'opacity-50' : 'active:opacity-90'
                  }`}>
                  {startMutation.isPending ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text className="text-white ml-2">Starting...</Text>
                    </View>
                  ) : (
                    <Text className="text-white font-semibold text-lg">Start Service</Text>
                  )}
                </TouchableOpacity>
                
                <View className="flex-row items-center justify-center gap-2">
                  <View className="w-3 h-3 rounded-full bg-red-500" />
                  <Text className="text-gray-600 text-sm">Service is stopped</Text>
                </View>
              </View>
            )}

          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

