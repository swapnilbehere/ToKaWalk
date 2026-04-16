import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Turn } from '../types';
import { colors } from '../constants/colors';

interface Props { turn: Turn; }

export function ChatBubble({ turn }: Props) {
  const isUser = turn.speaker === 'user';
  const text = turn.status === 'interrupted' ? `${turn.text}…` : turn.text;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowToka]}>
      {!isUser && <Text style={styles.label}>Nova</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleToka]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textToka]}>{text}</Text>
      </View>
      {isUser && <Text style={styles.label}>You</Text>}
    </View>
  );
}

export function TypingIndicator() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i - 1) * 150),
        ]),
      ),
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <View style={[styles.row, styles.rowToka]}>
      <Text style={styles.label}>Nova</Text>
      <View style={[styles.bubble, styles.bubbleToka, styles.typingBubble]}>
        {dots.map((dot, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: dot }]} />
        ))}
      </View>
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
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textFaint },
});
