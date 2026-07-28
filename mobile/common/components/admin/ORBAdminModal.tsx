import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { useStartORBMutation, useStopORBMutation } from '@/hooks/mutations/orb/useORBControl';
import { useResetStrategyData } from '@/hooks/mutations/strategy/useResetStrategyData';
import { PortfolioViewModal } from './PortfolioViewModal';
import { useToast } from '@/common/components/ui/Toast';

interface ORBAdminModalProps {
  visible: boolean;
  onClose: () => void;
  onViewLogs?: () => void;
  onViewPortfolio?: () => void;
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
  onViewLogs,
  onViewPortfolio,
}) => {
  const { data: status, isLoading, error } = useORBStatus();
  const startMutation = useStartORBMutation();
  const stopMutation = useStopORBMutation();
  const [portfolioModalVisible, setPortfolioModalVisible] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [clearDebugLogs, setClearDebugLogs] = useState(false);
  const resetMutation = useResetStrategyData();
  const toast = useToast();

  const isRunning = status?.running ?? false;
  const isCalculationPhase = status?.calculation_phase ?? false;
  const activeTickers = status?.active_tickers ?? [];
  const orbRangesCount = status?.orb_ranges_count ?? 0;

  const handleViewPortfolio = () => {
    if (onViewPortfolio) {
      onViewPortfolio();
    } else {
      setPortfolioModalVisible(true);
    }
    onClose();
  };

  const handleStartServiceDebug = () => {
    startMutation.mutate(true, {
      onSuccess: () => toast.success('ORB service started (debug mode)'),
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start ORB service'),
    });
  };

  const handleStartService = () => {
    startMutation.mutate(false, {
      onSuccess: () => toast.success('ORB service started'),
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start ORB service'),
    });
  };

  const handleStop = () => {
    stopMutation.mutate(undefined, {
      onSuccess: () => toast.success('ORB service stopped'),
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to stop ORB service'),
    });
  };

  const isLoadingAction = startMutation.isPending || stopMutation.isPending;

  const handleResetData = () => {
    if (!resetConfirming) {
      setResetConfirming(true);
      return;
    }
    resetMutation.mutate(
      { clear_debug_logs: clearDebugLogs },
      {
        onSuccess: (res) => {
          toast.success(res.message);
          setResetConfirming(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Reset failed');
          setResetConfirming(false);
        },
      },
    );
  };

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

          {/* Portfolio & Tools Section */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Analytics & Tools</Text>
            
            <View className="gap-3">
              {/* Portfolio View */}
              <TouchableOpacity
                onPress={handleViewPortfolio}
                className="w-full h-14 rounded-md bg-blue-600 items-center justify-center active:opacity-90">
                <View className="flex-row items-center gap-3">
                  <Ionicons name="briefcase-outline" size={20} color="#ffffff" />
                  <Text className="text-white font-semibold text-lg">Portfolio View</Text>
                </View>
              </TouchableOpacity>

              {/* View Logs */}
              {onViewLogs && (
                <TouchableOpacity
                  onPress={() => {
                    onViewLogs();
                    onClose();
                  }}
                  className="w-full h-14 rounded-md bg-gray-700 items-center justify-center active:opacity-90">
                  <View className="flex-row items-center gap-3">
                    <Ionicons name="document-text-outline" size={20} color="#ffffff" />
                    <Text className="text-white font-semibold text-lg">View Logs</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

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
                  onPress={handleStartServiceDebug}
                  disabled={isLoadingAction}
                  className={`w-full h-14 rounded-md bg-blue-600 border-2 border-orange-500 items-center justify-center ${
                    isLoadingAction ? 'opacity-50' : 'active:opacity-90'
                  }`}>
                  {startMutation.isPending ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text className="text-white ml-2">Starting...</Text>
                    </View>
                  ) : (
                    <Text className="text-white font-semibold text-lg">Start Debug</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleStartService}
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

          {/* ─── Danger Zone ─────────────────────────────────────── */}
          <View className="mb-8">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Danger Zone</Text>

            <View className="border border-red-300 rounded-xl p-4 bg-red-50">
              {/* Header row */}
              <View className="flex-row items-center gap-2 mb-2">
                <Ionicons name="warning-outline" size={20} color="#dc2626" />
                <Text className="text-red-700 font-semibold text-base">Reset Trade Data</Text>
              </View>

              <Text className="text-red-600 text-sm mb-4">
                Permanently deletes all rows from{' '}
                <Text className="font-mono font-semibold">orb_trades</Text>,{' '}
                <Text className="font-mono font-semibold">orb_session</Text>,{' '}
                <Text className="font-mono font-semibold">performance_reviews</Text>, and{' '}
                <Text className="font-mono font-semibold">orb_pending_confirmations</Text> — every
                Trade Log, Stats, and Daily Review entry goes with it. Also resets every running
                strategy's session state (halts, cooldowns, today's P&L) so it takes effect
                immediately, not just after a restart. An engine with an open position right now
                is left running as-is, but its trade history won't be there to log its exit into.
              </Text>

              {/* Clear debug logs toggle */}
              <View className="flex-row items-center justify-between mb-4 bg-red-100 rounded-lg px-3 py-2">
                <Text className="text-red-700 text-sm font-medium">Also clear debug logs</Text>
                <Switch
                  value={clearDebugLogs}
                  onValueChange={setClearDebugLogs}
                  trackColor={{ false: '#fecaca', true: '#ef4444' }}
                  thumbColor="#ffffff"
                />
              </View>

              {resetConfirming ? (
                <View className="gap-2">
                  <Text className="text-red-700 font-semibold text-sm text-center mb-1">
                    Are you sure? This cannot be undone.
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => setResetConfirming(false)}
                      className="flex-1 h-11 rounded-md bg-gray-200 items-center justify-center">
                      <Text className="text-gray-700 font-semibold">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleResetData}
                      disabled={resetMutation.isPending}
                      className={`flex-1 h-11 rounded-md bg-red-600 items-center justify-center ${
                        resetMutation.isPending ? 'opacity-50' : 'active:opacity-90'
                      }`}>
                      {resetMutation.isPending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text className="text-white font-semibold">Yes, Delete All</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleResetData}
                  className="w-full h-11 rounded-md bg-red-600 items-center justify-center active:opacity-90">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="trash-outline" size={18} color="#ffffff" />
                    <Text className="text-white font-semibold">Reset Trade Data</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

        </View>
      </ScrollView>

      {/* Portfolio View Modal */}
      <PortfolioViewModal
        visible={portfolioModalVisible}
        onClose={() => setPortfolioModalVisible(false)}
      />
    </Modal>
  );
};

