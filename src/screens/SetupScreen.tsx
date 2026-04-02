import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { SetupStatus } from '../hooks/useModelSetup';
import { colors } from '../constants/colors';

interface Props {
  status: SetupStatus;
  voskProgress: number;
  llmProgress: number;
  errorMessage: string | null;
  onRetry: () => void;
}

const STATUS_LABEL: Partial<Record<SetupStatus, string>> = {
  checking: 'Checking...',
  'requesting-permissions': 'Requesting permissions...',
  'downloading-vosk': 'Downloading speech recognition model',
  'downloading-llm': 'Downloading language model',
};

function ProgressBar({ label, progress, size }: { label: string; progress: number; size: string }) {
  const pct = Math.round(progress * 100);
  return (
    <View style={styles.barSection}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barMeta}>{size}  ·  {pct}%</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export function SetupScreen({ status, voskProgress, llmProgress, errorMessage, onRetry }: Props) {
  if (status === 'permissions-denied') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>ToKaWalk</Text>
        <Text style={styles.tagline}>your walking companion</Text>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            Microphone access is required for ToKaWalk to work.{'\n\n'}
            Please allow microphone permission in your device settings, then reopen the app.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.retryText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>ToKaWalk</Text>
        <Text style={styles.tagline}>your walking companion</Text>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>ToKaWalk</Text>
      <Text style={styles.tagline}>your walking companion</Text>

      <View style={styles.content}>
        <Text style={styles.heading}>First launch setup</Text>
        <Text style={styles.subheading}>
          Downloading models for offline use. This happens once.
        </Text>

        <ProgressBar label="Speech recognition model" progress={voskProgress} size="~40 MB" />
        <ProgressBar label="Language model"  progress={llmProgress}  size="~2 GB"  />

        <Text style={styles.status}>{STATUS_LABEL[status] ?? ''}</Text>
        <Text style={styles.hint}>Keep the app open. Wi-Fi recommended for the language model.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: colors.orange, fontSize: 26, fontWeight: '700', letterSpacing: 2 },
  tagline: { color: colors.textFaint, fontSize: 12, marginBottom: 40 },
  content: { width: '100%' },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  subheading: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginBottom: 24 },
  barSection: { marginBottom: 18 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { color: colors.textMuted, fontSize: 12 },
  barMeta: { color: colors.textFaint, fontSize: 11 },
  barBg: { height: 4, backgroundColor: colors.surface, borderRadius: 2 },
  barFill: { height: 4, backgroundColor: colors.orange, borderRadius: 2 },
  status: { color: colors.green, fontSize: 12, marginTop: 12 },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 8 },
  errorBox: { width: '100%', alignItems: 'center' },
  errorText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  retryBtn: { backgroundColor: colors.orange, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: colors.white, fontWeight: '700', fontSize: 13 },
});
