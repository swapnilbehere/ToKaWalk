import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SetupScreen } from './src/screens/SetupScreen';
import { useModelSetup } from './src/hooks/useModelSetup';
import { colors } from './src/constants/colors';

export default function App() {
  const { status, voskProgress, llmProgress, errorMessage, retry } = useModelSetup();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {status === 'ready' ? (
        <AppNavigator />
      ) : (
        <SetupScreen
          status={status}
          voskProgress={voskProgress}
          llmProgress={llmProgress}
          errorMessage={errorMessage}
          onRetry={retry}
        />
      )}
    </GestureHandlerRootView>
  );
}
