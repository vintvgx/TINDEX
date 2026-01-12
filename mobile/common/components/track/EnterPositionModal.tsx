import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BaseModal } from '@/common/components/FEED/modals/BaseModal';

interface EnterPositionModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (entryPrice: number, positionSize: number) => void;
  currentPrice: number;
  isSubmitting?: boolean;
}

export const EnterPositionModal: React.FC<EnterPositionModalProps> = ({
  visible,
  onClose,
  onSubmit,
  currentPrice,
  isSubmitting = false,
}) => {
  const [entryPrice, setEntryPrice] = useState(currentPrice.toString());
  const [positionSize, setPositionSize] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    
    const price = parseFloat(entryPrice);
    const size = parseInt(positionSize, 10);

    if (isNaN(price) || price <= 0) {
      setError('Please enter a valid entry price');
      return;
    }

    if (isNaN(size) || size <= 0) {
      setError('Please enter a valid position size');
      return;
    }

    onSubmit(price, size);
  };

  const handleClose = () => {
    setEntryPrice(currentPrice.toString());
    setPositionSize('1');
    setError(null);
    onClose();
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      onSubmit={handleSubmit}
      headerText="Enter Position"
      submitButtonText="Enter Position"
      submitButtonDisabled={isSubmitting || !!error}
      isSubmitting={isSubmitting}
      enableKeyboardAvoiding={true}
    >
      <View>
        <View className="mb-4">
          <Text className="text-base font-semibold text-white mb-2">Entry Price *</Text>
          <TextInput
            value={entryPrice}
            onChangeText={(text) => {
              setEntryPrice(text);
              setError(null);
            }}
            placeholder="0.00"
            keyboardType="decimal-pad"
            className={`border rounded-lg p-4 text-base text-white bg-gray-800 ${
              error ? "border-red-500" : "border-gray-700"
            }`}
            placeholderTextColor="#6b7280"
            editable={!isSubmitting}
          />
          <Text className="text-sm text-gray-500 mt-1">
            Current mark: ${currentPrice.toFixed(2)}
          </Text>
        </View>

        <View className="mb-4">
          <Text className="text-base font-semibold text-white mb-2">Position Size *</Text>
          <TextInput
            value={positionSize}
            onChangeText={(text) => {
              setPositionSize(text);
              setError(null);
            }}
            placeholder="1"
            keyboardType="number-pad"
            className={`border rounded-lg p-4 text-base text-white bg-gray-800 ${
              error ? "border-red-500" : "border-gray-700"
            }`}
            placeholderTextColor="#6b7280"
            editable={!isSubmitting}
          />
          <Text className="text-sm text-gray-500 mt-1">
            Number of contracts
          </Text>
        </View>

        {error && (
          <View className="mb-4 bg-red-500/20 border border-red-500/50 rounded-lg p-3">
            <Text className="text-red-400 text-sm">{error}</Text>
          </View>
        )}
      </View>
    </BaseModal>
  );
};
