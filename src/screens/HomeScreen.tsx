import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SessionMode, Session } from '../types';
import { ModeSelector } from '../components/ModeSelector';
import { SessionCard } from '../components/SessionCard';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [selectedMode, setSelectedMode] = useState<SessionMode>('just-walk');
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const prefs = await new PreferencesRepository(db).get();
      setSelectedMode(prefs.defaultMode);
      const sessions = await new SessionRepository(db).list(3);
      setRecentSessions(sessions);
    })();
  }, []);

  const handleStartWalk = () => {
    navigation.navigate('WalkMode', { mode: selectedMode });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>ToKaWalk</Text>
      <Text style={styles.tagline}>your walking companion</Text>

      <Text style={styles.sectionLabel}>WHAT KIND OF WALK?</Text>
      <ModeSelector selected={selectedMode} onSelect={setSelectedMode} />

      <TouchableOpacity style={styles.startBtn} onPress={handleStartWalk}>
        <Text style={styles.startBtnText}>Start Walk</Text>
      </TouchableOpacity>

      {recentSessions.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.sectionLabel}>RECENT WALKS</Text>
          {recentSessions.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              onPress={() => navigation.navigate('SessionDetail', { sessionId: s.id })}
            />
          ))}
          <TouchableOpacity onPress={() => navigation.navigate('History')}>
            <Text style={styles.viewAll}>View all →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginTop: 12 },
  tagline: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginBottom: 24 },
  sectionLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  startBtn: { backgroundColor: colors.orange, borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  startBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  history: { marginTop: 24 },
  viewAll: { color: colors.orange, fontSize: 11, textAlign: 'right', marginTop: 4 },
});
