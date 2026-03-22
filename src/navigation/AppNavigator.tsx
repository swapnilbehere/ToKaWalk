import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SessionMode } from '../types';
import { HomeScreen } from '../screens/HomeScreen';
import { WalkModeScreen } from '../screens/WalkModeScreen';
import { ChatModeScreen } from '../screens/ChatModeScreen';
import { SessionDetailScreen } from '../screens/SessionDetailScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Home: undefined;
  WalkMode: { mode: SessionMode };
  ChatMode: { mode: SessionMode };
  SessionDetail: { sessionId: number };
  History: undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="WalkMode" component={WalkModeScreen} />
        <Stack.Screen name="ChatMode" component={ChatModeScreen} />
        <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
