import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { MicOrb } from '../components/MicOrb';
import { LLMModeBadge } from '../components/LLMModeBadge';
import { useConversationEngine } from '../hooks/useConversationEngine';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

type WalkModeRouteProp = RouteProp<RootStackParamList, 'WalkMode'>;

const STATE_LABELS: Record<string, string> = {
  listening: 'Listening...',
  processing: 'Thinking...',
  speaking: 'Nova is speaking...',
  recovering: 'Recovering mic...',
  degraded: 'Mic issue. Tap End or try again.',
  idle: 'just talk — "Bye Nova" to end',
};

export function WalkModeScreen() {
  const route = useRoute<WalkModeRouteProp>();
  const navigation = useNavigation<any>();
  const { mode } = route.params;
  const { state, statusDetail, llmMode, sttMode, startSession, endSession, toggleLLMMode } = useConversationEngine();
  const [elapsed, setElapsed] = useState(0);
  const hasBeenActive = React.useRef(false);
  const navigatedAway = React.useRef(false);

  useEffect(() => {
    startSession(mode, 'voice');
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [mode, startSession]);

  // Track when session becomes active, then navigate home when it returns to idle
  // (only if the user didn't explicitly navigate away via Chat or End buttons)
  useEffect(() => {
    if (state !== 'idle') {
      hasBeenActive.current = true;
    } else if (hasBeenActive.current && !navigatedAway.current) {
      navigation.navigate('Home');
    }
  }, [state, navigation]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const handleEnd = async () => {
    navigatedAway.current = true;
    await endSession();
    navigation.navigate('Home');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.modeLabel}>{MODE_LABELS[mode]} · {elapsedStr}</Text>
        <LLMModeBadge mode={llmMode} onToggle={toggleLLMMode} />
      </View>

      <View style={styles.center}>
        <MicOrb state={state} />
        <Text style={styles.status}>{STATE_LABELS[state] ?? ''}</Text>
        {statusDetail ? <Text style={styles.statusDetail}>{statusDetail}</Text> : null}
        {sttMode === 'offline' ? (
          <Text style={styles.offlineBadge}>Offline STT</Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.btn} onPress={() => { navigatedAway.current = true; navigation.replace('ChatMode', { mode }); }}>
          <Text style={styles.btnIcon}>💬</Text>
          <Text style={styles.btnLabel}>Chat Mode</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.btnIcon}>⚙️</Text>
          <Text style={styles.btnLabel}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={handleEnd}>
          <Text style={styles.btnIcon}>■</Text>
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeLabel: { color: colors.textFaint, fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  status: { color: colors.green, fontSize: 13, marginTop: 16 },
  statusDetail: { color: colors.textFaint, fontSize: 11, marginTop: 8, textAlign: 'center', maxWidth: 220 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 20 },
  btn: { alignItems: 'center' },
  btnIcon: { fontSize: 22, color: colors.textMuted, backgroundColor: colors.surface, padding: 8, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  btnLabel: { color: colors.textFaint, fontSize: 10, marginTop: 4 },
  offlineBadge: { color: colors.orange, fontSize: 10, marginTop: 6, borderWidth: 1, borderColor: colors.orange, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
});
