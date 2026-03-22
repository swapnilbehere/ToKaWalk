import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Session } from '../types';
import { MODE_LABELS } from '../constants/modes';
import { colors } from '../constants/colors';

interface Props {
  session: Session;
  preview?: string;
  onPress: () => void;
  onLongPress?: () => void;
}

export function SessionCard({ session, preview, onPress, onLongPress }: Props) {
  const date = new Date(session.startedAt);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const durStr = session.durationSecs ? `${Math.round(session.durationSecs / 60)} min` : '';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.header}>
        <Text style={styles.mode}>{MODE_LABELS[session.mode]}</Text>
        <Text style={styles.meta}>{dateStr}{durStr ? ` · ${durStr}` : ''}</Text>
      </View>
      {preview ? <Text style={styles.preview} numberOfLines={1}>{preview}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  mode: { color: colors.orange, fontSize: 11, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 10 },
  preview: { color: colors.textDim, fontSize: 10, marginTop: 4 },
});
