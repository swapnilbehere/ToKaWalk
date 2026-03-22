import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Session } from '../types';
import { SessionCard } from '../components/SessionCard';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { SessionRepository } from '../services/storage/SessionRepository';

export function HistoryScreen() {
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<Session[]>([]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    setSessions(await new SessionRepository(db).list(200));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (session: Session) => {
    Alert.alert('Delete session?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const db = await getDatabase();
          await new SessionRepository(db).delete(session.id);
          load();
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Past Walks</Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={s => String(s.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onPress={() => navigation.navigate('SessionDetail', { sessionId: item.id })}
            onLongPress={() => handleDelete(item)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: 48 },
  back: { color: colors.orange, fontSize: 20 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  list: { padding: 16 },
});
