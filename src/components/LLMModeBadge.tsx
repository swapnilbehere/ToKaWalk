import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LLMMode } from '../types';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

interface Props {
  mode: LLMMode;
  onToggle: () => void;
  disabled?: boolean;
}

export function LLMModeBadge({ mode, onToggle, disabled }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = async () => {
    if (mode === 'local') {
      const db = getDatabase();
      const repo = new PreferencesRepository(db);
      const prefs = await repo.get();
      if (!prefs.hasSeenOnlineTooltip) {
        setShowTooltip(true);
        await repo.set('hasSeenOnlineTooltip', true);
        setTimeout(() => setShowTooltip(false), 3000);
      }
    }
    onToggle();
  };

  return (
    <View>
      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>Online mode connects to the internet for smarter responses</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.badge, disabled && styles.disabled]}
        onPress={handleToggle}
        disabled={disabled}
      >
        <Text style={styles.text}>{mode === 'local' ? '📴 Local' : '🌐 Online'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderColor: colors.borderActive, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  disabled: { borderColor: colors.border, opacity: 0.5 },
  text: { color: colors.orange, fontSize: 11 },
  tooltip: { position: 'absolute', bottom: 36, right: 0, backgroundColor: '#1c1917', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, width: 200, zIndex: 99 },
  tooltipText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
