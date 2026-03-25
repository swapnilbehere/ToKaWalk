import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SetupScreen } from './src/screens/SetupScreen';
import { useModelSetup } from './src/hooks/useModelSetup';
import { initDatabase } from './src/services/storage/database';
import { colors } from './src/constants/colors';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const { status, voskProgress, llmProgress, errorMessage, retry } = useModelSetup();

  useEffect(() => {
    initDatabase().then(() => setDbReady(true)).catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {status === 'ready' && dbReady ? (
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
