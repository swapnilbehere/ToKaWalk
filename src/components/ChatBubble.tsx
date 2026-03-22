import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Turn } from '../types';
import { colors } from '../constants/colors';

interface Props { turn: Turn; }

export function ChatBubble({ turn }: Props) {
  const isUser = turn.speaker === 'user';
  const text = turn.status === 'interrupted' ? `${turn.text}…` : turn.text;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowToka]}>
      {!isUser && <Text style={styles.label}>Toka</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleToka]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textToka]}>{text}</Text>
      </View>
      {isUser && <Text style={styles.label}>You</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, maxWidth: '82%' },
  rowUser: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowToka: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  label: { color: colors.textFaint, fontSize: 9, marginBottom: 2 },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleUser: { backgroundColor: colors.orange, borderBottomRightRadius: 2 },
  bubbleToka: { borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 2 },
  text: { fontSize: 13, lineHeight: 20 },
  textUser: { color: colors.white },
  textToka: { color: colors.text },
});
