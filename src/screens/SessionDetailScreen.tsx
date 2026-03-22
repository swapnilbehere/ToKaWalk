import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Session, Turn, Summary } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';
import { TurnRepository } from '../services/storage/TurnRepository';
import { SummaryRepository } from '../services/storage/SummaryRepository';
import { RootStackParamList } from '../navigation/AppNavigator';

type SessionDetailRouteProp = RouteProp<RootStackParamList, 'SessionDetail'>;

export function SessionDetailScreen() {
  const route = useRoute<SessionDetailRouteProp>();
  const navigation = useNavigation();
  const { sessionId } = route.params;
  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const sessions = await new SessionRepository(db).list(100);
      setSession(sessions.find(s => s.id === sessionId) ?? null);
      setTurns(await new TurnRepository(db).getForSession(sessionId));
      setSummary(await new SummaryRepository(db).getForSession(sessionId));
    })();
  }, [sessionId]);

  if (!session) return null;

  const durStr = session.durationSecs ? `${Math.round(session.durationSecs / 60)} min` : '';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <Text style={styles.mode}>{MODE_LABELS[session.mode]}</Text>
      <Text style={styles.meta}>
        {new Date(session.startedAt).toLocaleDateString()}{durStr ? ` · ${durStr}` : ''} · {session.modelUsed === 'local' ? 'Local model' : 'Enhanced'}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>✨ Summary</Text>
        <Text style={styles.summaryText}>
          {summary?.summaryText || 'Summary unavailable.'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📄 Transcript</Text>
        {turns.map(turn => (
          <View key={turn.id} style={styles.turnRow}>
            <Text style={[styles.turnSpeaker, turn.speaker === 'ai' && styles.turnSpeakerToka]}>
              {turn.speaker === 'user' ? 'You' : 'Toka'}
              {turn.status === 'interrupted' ? ' [interrupted]' : ''}:
            </Text>
            <Text style={styles.turnText}>{turn.text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  back: { marginBottom: 16 },
  backArrow: { color: colors.orange, fontSize: 20 },
  mode: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textFaint, fontSize: 11, marginBottom: 16 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, marginBottom: 12 },
  cardTitle: { color: colors.orange, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  summaryText: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  turnRow: { marginBottom: 10 },
  turnSpeaker: { color: colors.textDim, fontSize: 11 },
  turnSpeakerToka: { color: colors.orangeMuted },
  turnText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
