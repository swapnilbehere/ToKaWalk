import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SessionMode } from '../types';
import { MODE_LABELS, MODE_DESCRIPTIONS } from '../constants/modes';
import { colors } from '../constants/colors';

const MODES: SessionMode[] = ['just-walk', 'brain-dump', 'journal', 'learn'];

interface Props {
  selected: SessionMode;
  onSelect: (mode: SessionMode) => void;
}

export function ModeSelector({ selected, onSelect }: Props) {
  return (
    <View style={styles.container}>
      {MODES.map(mode => (
        <TouchableOpacity
          key={mode}
          style={[styles.item, selected === mode && styles.itemActive]}
          onPress={() => onSelect(mode)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === mode }}
        >
          <Text style={[styles.label, selected === mode && styles.labelActive]}>
            {MODE_LABELS[mode]}
          </Text>
          <Text style={styles.description}>{MODE_DESCRIPTIONS[mode]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  itemActive: { borderWidth: 2, borderColor: colors.borderActive },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  labelActive: { color: colors.orange },
  description: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
});
