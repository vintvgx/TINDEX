import { signOut } from '@/utils/auth/function';
import React from 'react';
import { View, Text, Pressable } from 'react-native';

interface HeaderProps {
  onAddPress: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onAddPress }) => {
  return (
    <View className="flex-row justify-between items-center px-4 py-3">
      {/* App Title */}
      <Text className="text-3xl font-bold text-blue-600">
        alethia
      </Text>
      
      {/* Add Button */}
      <View className="flex-row justify-between items-center">
        <Pressable
          className='mr-4'
          onPress={async () => {
            signOut();
          }}>
          <Text>Sign Out</Text>
        </Pressable> 
      <Pressable
        onPress={onAddPress}
        className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"
        android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
      >
        <Text className="text-xl font-semibold text-gray-700">+</Text>
      </Pressable>
      </View>
    </View>
  );
};