import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ChatBubble } from '../components/ChatBubble';
import { LLMModeBadge } from '../components/LLMModeBadge';
import { useConversationEngine } from '../hooks/useConversationEngine';
import { Turn } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

type ChatModeRouteProp = RouteProp<RootStackParamList, 'ChatMode'>;

export function ChatModeScreen() {
  const route = useRoute<ChatModeRouteProp>();
  const navigation = useNavigation<any>();
  const { mode } = route.params;
  const { state, llmMode, endSession, toggleLLMMode } = useConversationEngine();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const listRef = useRef<FlatList>(null);

  // Poll turns from DB every second (simple approach for v1)
  useEffect(() => {
    const interval = setInterval(async () => {
      // sessionId would be tracked in a shared context in a fuller implementation
      // For now, load the most recent session's turns
    }, 1000);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => { clearInterval(interval); clearInterval(timer); };
  }, []);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [turns]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.modeLabel}>{MODE_LABELS[mode]} · {elapsedStr}</Text>
        <View style={styles.headerRight}>
          <LLMModeBadge mode={llmMode} onToggle={toggleLLMMode} />
          <TouchableOpacity onPress={() => navigation.navigate('WalkMode', { mode })}>
            <Text style={styles.walkIcon}>🚶</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => <ChatBubble turn={item} />}
        contentContainerStyle={styles.list}
      />

      <View style={styles.inputBar}>
        <Text style={styles.placeholder}>just talk or tap mic</Text>
        <TouchableOpacity style={styles.micBtn}>
          <Text style={styles.micIcon}>🎙️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  modeLabel: { color: colors.textFaint, fontSize: 11 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  walkIcon: { fontSize: 18 },
  list: { padding: 16, paddingBottom: 8 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  placeholder: { flex: 1, color: colors.textFaint, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  micBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.borderActive, alignItems: 'center', justifyContent: 'center' },
  micIcon: { fontSize: 18 },
});
