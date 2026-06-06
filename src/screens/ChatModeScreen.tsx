import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ChatBubble, TypingIndicator } from '../components/ChatBubble';
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
  const { state, llmMode, startSession, processTextInput, toggleLLMMode } = useConversationEngine();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [inputText, setInputText] = useState('');
  const [streamingTurnId, setStreamingTurnId] = useState<number | null>(null);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const navigatedAway = useRef(false);

  useEffect(() => {
    let mounted = true;
    console.log('[ChatMode] Mounting screen', { mode });
    if (mounted) startSession(mode, 'text');
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => {
      mounted = false;
      console.log('[ChatMode] Unmounting screen');
      clearInterval(timer);
    };
  }, [mode, startSession]);

  useEffect(() => {
    // Avoid imperative scroll churn while debugging Fabric crashes on async updates.
  }, [turns]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    const userTurn: Turn = { id: Date.now(), sessionId: 0, speaker: 'user', text, timestamp: Date.now(), status: 'completed' };
    setTurns(prev => [...prev, userTurn]);

    // Track the streaming bubble locally — avoids state reads inside the callback.
    let localStreamId: number | null = null;
    let accumulated = '';

    try {
      console.log('[ChatMode] sending text:', text);
      const aiResponse = await processTextInput(text, (token) => {
        accumulated += token;
        if (localStreamId === null) {
          // First token: add the bubble and hide the typing indicator.
          localStreamId = Date.now() + 1;
          const sid = localStreamId;
          setStreamingTurnId(sid);
          setTurns(prev => [...prev, {
            id: sid,
            sessionId: 0,
            speaker: 'ai',
            text: accumulated,
            timestamp: Date.now(),
            status: 'completed',
          }]);
        } else {
          const sid = localStreamId;
          const snap = accumulated;
          setTurns(prev => prev.map(t => t.id === sid ? { ...t, text: snap } : t));
        }
      });

      setStreamingTurnId(null);

      console.log('[ChatMode] received response:', {
        status: aiResponse.status,
        textLength: aiResponse.text.length,
        textPreview: aiResponse.text.slice(0, 120),
      });

      if (!aiResponse.text.trim()) {
        if (localStreamId !== null) {
          const sid = localStreamId;
          setTurns(prev => prev.filter(t => t.id !== sid));
        }
        if (aiResponse.status === 'completed') {
          navigatedAway.current = true;
          navigation.navigate('Home');
        } else {
          const errTurn: Turn = {
            id: Date.now() + 1,
            sessionId: 0,
            speaker: 'ai',
            text: "Couldn't get a response. Please try again.",
            timestamp: Date.now(),
            status: 'interrupted',
          };
          setTurns(prev => [...prev, errTurn]);
        }
        return;
      }

      if (localStreamId !== null) {
        // Streaming bubble already has the text — just stamp the final status.
        const sid = localStreamId;
        setTurns(prev => prev.map(t => t.id === sid ? { ...t, status: aiResponse.status } : t));
      } else {
        // No tokens were streamed (shouldn't happen); add turn directly.
        setTurns(prev => [...prev, {
          id: Date.now() + 1,
          sessionId: 0,
          speaker: 'ai',
          text: aiResponse.text,
          timestamp: Date.now(),
          status: aiResponse.status,
        }]);
      }
    } catch (error) {
      console.error('[ChatMode] send failed:', error);
      setStreamingTurnId(null);
      if (localStreamId !== null) {
        const sid = localStreamId;
        setTurns(prev => prev.filter(t => t.id !== sid));
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Text style={styles.modeLabel}>{MODE_LABELS[mode]} · {elapsedStr}</Text>
        <View style={styles.headerRight}>
          <LLMModeBadge mode={llmMode} onToggle={toggleLLMMode} />
          <TouchableOpacity onPress={() => { navigatedAway.current = true; navigation.replace('WalkMode', { mode }); }}>
            <Text style={styles.walkIcon}>🚶</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => <ChatBubble turn={item} />}
        ListFooterComponent={state === 'processing' && streamingTurnId === null ? <TypingIndicator /> : null}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={styles.list}
      />

      <View style={styles.inputBar}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor={colors.textFaint}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline={false}
          autoFocus={true}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  input: { flex: 1, color: colors.text ?? '#fff', fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.borderActive ?? '#4a9', alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#fff', fontSize: 16 },
});
