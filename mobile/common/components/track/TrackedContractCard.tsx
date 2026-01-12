import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrackedOptionContract } from '@/common/types/options';
import { useUpdateContractStatus } from '@/hooks/mutations/track/useUpdateContractStatus';
import { useUntrackContract } from '@/hooks/mutations/track/useUntrackContract';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { EnterPositionModal } from './EnterPositionModal';

interface TrackedContractCardProps {
  contract: TrackedOptionContract;
  onStatusUpdate?: () => void;
}

export const TrackedContractCard: React.FC<TrackedContractCardProps> = ({
  contract,
  onStatusUpdate,
}) => {
  const { authState: { user } } = useAuth();
  const updateStatus = useUpdateContractStatus();
  const untrackContract = useUntrackContract();
  const [showEnterModal, setShowEnterModal] = useState(false);

  const snapshot = contract.tracking_snapshot || {};
  const currentPrice = snapshot.mark || contract.entry_price || 0;
  const strike = contract.strike || snapshot.strike || 0;
  const expirationDate = new Date(contract.expiration_date);
  const dte = Math.ceil((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const getStatusColor = () => {
    switch (contract.status) {
      case 'tracking':
        return 'bg-blue-500/30 border-blue-500/50';
      case 'entered':
        return 'bg-emerald-500/30 border-emerald-500/50';
      case 'exited':
        return 'bg-gray-500/30 border-gray-500/50';
      case 'expired':
        return 'bg-red-500/30 border-red-500/50';
      case 'cancelled':
        return 'bg-gray-600/30 border-gray-600/50';
      default:
        return 'bg-gray-500/30 border-gray-500/50';
    }
  };

  const getStatusText = () => {
    switch (contract.status) {
      case 'tracking':
        return 'Tracking';
      case 'entered':
        return 'Entered';
      case 'exited':
        return 'Exited';
      case 'expired':
        return 'Expired';
      case 'cancelled':
        return 'Cancelled';
      default:
        return contract.status;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleEnterPosition = () => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }
    setShowEnterModal(true);
  };

  const handleSubmitPosition = async (entryPrice: number, positionSize: number) => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    try {
      await updateStatus.mutateAsync({
        userId: user.id,
        contractId: contract.id,
        status: 'entered',
        entryPrice: entryPrice,
        positionSize: positionSize,
      });
      setShowEnterModal(false);
      onStatusUpdate?.();
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to enter position'
      );
    }
  };

  const handleUntrack = () => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    Alert.alert(
      'Untrack Contract',
      `Are you sure you want to stop tracking ${contract.contract_symbol}? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Untrack',
          style: 'destructive',
          onPress: async () => {
            try {
              await untrackContract.mutateAsync(contract.id);
              setTimeout(() => {
                Alert.alert('Success', 'Contract untracked successfully');
              }, 100);
              onStatusUpdate?.();
            } catch (error) {
              setTimeout(() => {
                Alert.alert(
                  'Error',
                  error instanceof Error ? error.message : 'Failed to untrack contract'
                );
              }, 100);
            }
          },
        },
      ]
    );
  };

  const getPnLDisplay = () => {
    if (contract.status === 'entered' && contract.entry_price) {
      const unrealizedPnL = (currentPrice - contract.entry_price) * (contract.position_size || 1);
      const unrealizedPnLPercent = ((currentPrice - contract.entry_price) / contract.entry_price) * 100;
      const isPositive = unrealizedPnL >= 0;
      
      return (
        <View className="mt-3 pt-3 border-t border-white/10">
          <Text className="text-white/70 text-xs mb-1">Unrealized P&L</Text>
          <View className="flex-row items-baseline justify-between">
            <Text className={`text-lg font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(unrealizedPnL)}
            </Text>
            <Text className={`text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{unrealizedPnLPercent.toFixed(2)}%
            </Text>
          </View>
        </View>
      );
    }
    
    if (contract.status === 'exited' && contract.pnl !== undefined) {
      const isPositive = contract.pnl >= 0;
      return (
        <View className="mt-3 pt-3 border-t border-white/10">
          <Text className="text-white/70 text-xs mb-1">Realized P&L</Text>
          <View className="flex-row items-baseline justify-between">
            <Text className={`text-lg font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(contract.pnl)}
            </Text>
            {contract.pnl_percentage !== undefined && (
              <Text className={`text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? '+' : ''}{contract.pnl_percentage.toFixed(2)}%
              </Text>
            )}
          </View>
        </View>
      );
    }
    
    return null;
  };

  return (
    <View className={`rounded-xl p-4 mb-4 border ${getStatusColor()}`}>
      {/* Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Text className="text-white text-lg font-bold">{contract.ticker}</Text>
            <View className={`px-2 py-0.5 rounded ${
              contract.option_type === 'CALL' ? 'bg-emerald-500/30' : 'bg-red-500/30'
            }`}>
              <Text className="text-white text-xs font-semibold">{contract.option_type}</Text>
            </View>
          </View>
          <Text className="text-white/70 text-sm">{contract.contract_symbol}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <View className={`px-3 py-1 rounded-full ${getStatusColor()}`}>
            <Text className="text-white text-xs font-semibold">{getStatusText()}</Text>
          </View>
          <TouchableOpacity
            onPress={handleUntrack}
            disabled={untrackContract.isPending}
            className="p-2 rounded-full bg-red-500/20 border border-red-500/50"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons 
              name="close-circle" 
              size={20} 
              color={untrackContract.isPending ? "#9CA3AF" : "#EF4444"} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Contract Details */}
      <View className="flex-row flex-wrap gap-4 mb-3">
        <View>
          <Text className="text-white/70 text-xs mb-1">Strike</Text>
          <Text className="text-white text-base font-semibold">{formatCurrency(strike)}</Text>
        </View>
        <View>
          <Text className="text-white/70 text-xs mb-1">Current Price</Text>
          <Text className="text-white text-base font-semibold">{formatCurrency(currentPrice)}</Text>
        </View>
        <View>
          <Text className="text-white/70 text-xs mb-1">DTE</Text>
          <Text className="text-white text-base font-semibold">{dte}</Text>
        </View>
        <View>
          <Text className="text-white/70 text-xs mb-1">Expiration</Text>
          <Text className="text-white text-base font-semibold">{formatDate(contract.expiration_date)}</Text>
        </View>
      </View>

      {/* Entry/Exit Info */}
      {contract.entry_price && (
        <View className="mb-3 pt-3 border-t border-white/10">
          <Text className="text-white/70 text-xs mb-1">Entry Price</Text>
          <Text className="text-white text-sm font-semibold">
            {formatCurrency(contract.entry_price)}
            {contract.position_size && contract.position_size > 1 && (
              <Text className="text-white/70"> × {contract.position_size}</Text>
            )}
          </Text>
          {contract.entry_date && (
            <Text className="text-white/50 text-xs mt-1">{formatDate(contract.entry_date)}</Text>
          )}
        </View>
      )}

      {contract.exit_price && (
        <View className="mb-3 pt-3 border-t border-white/10">
          <Text className="text-white/70 text-xs mb-1">Exit Price</Text>
          <Text className="text-white text-sm font-semibold">{formatCurrency(contract.exit_price)}</Text>
          {contract.exit_date && (
            <Text className="text-white/50 text-xs mt-1">{formatDate(contract.exit_date)}</Text>
          )}
        </View>
      )}

      {/* PnL Display */}
      {getPnLDisplay()}

      {/* Action Button */}
      {contract.status === 'tracking' && (
        <TouchableOpacity
          onPress={handleEnterPosition}
          disabled={updateStatus.isPending}
          className={`mt-4 bg-emerald-600 rounded-lg p-3 items-center justify-center ${
            updateStatus.isPending ? 'opacity-50' : ''
          }`}>
          <Text className="text-white font-semibold">
            {updateStatus.isPending ? 'Entering...' : 'Enter Position'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Score Badge */}
      {contract.initial_analysis_score && (
        <View className="mt-3 pt-3 border-t border-white/10 flex-row items-center justify-between">
          <Text className="text-white/70 text-xs">Initial Score</Text>
          <Text className="text-white text-sm font-semibold">{contract.initial_analysis_score.toFixed(1)}</Text>
        </View>
      )}

      {/* Enter Position Modal */}
      <EnterPositionModal
        visible={showEnterModal}
        onClose={() => setShowEnterModal(false)}
        onSubmit={handleSubmitPosition}
        currentPrice={currentPrice}
        isSubmitting={updateStatus.isPending}
      />
    </View>
  );
};
