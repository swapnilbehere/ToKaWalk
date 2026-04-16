import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SetupScreen } from './src/screens/SetupScreen';
import { useModelSetup } from './src/hooks/useModelSetup';
import { initDatabase } from './src/services/storage/database';
import { colors } from './src/constants/colors';
import { ErrorBoundary } from './src/components/ErrorBoundary';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const { status, llmProgress, errorMessage, retry } = useModelSetup();

  useEffect(() => {
    initDatabase().then(() => setDbReady(true)).catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
    <ErrorBoundary>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {status === 'ready' && dbReady ? (
        <AppNavigator />
      ) : (
        <SetupScreen
          status={status}
          llmProgress={llmProgress}
          errorMessage={errorMessage}
          onRetry={retry}
        />
      )}
    </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
