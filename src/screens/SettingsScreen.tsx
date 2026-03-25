import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Preferences } from '../types';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';

export function SettingsScreen() {
  const navigation = useNavigation();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [repo, setRepo] = useState<PreferencesRepository | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState(true);

  useEffect(() => {
    (async () => {
      const db = getDatabase();
      const r = new PreferencesRepository(db);
      setRepo(r);
      setPrefs(await r.get());
    })();
  }, []);

  const update = async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (!repo || !prefs) return;
    await repo.set(key, value);
    setPrefs({ ...prefs, [key]: value });
  };

  if (!prefs) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backArrow}>←  Settings</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>MICROPHONE</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Outdoor mode (raises VAD threshold)</Text>
        <Switch
          value={prefs.vadSensitivity === 'outdoor'}
          onValueChange={v => update('vadSensitivity', v ? 'outdoor' : 'indoor')}
          trackColor={{ true: colors.orange }}
        />
      </View>

      <Text style={styles.sectionLabel}>VOICE</Text>
      <View style={styles.row}>
        <Text style={styles.label}>TTS Speed</Text>
        <Text style={styles.value}>{Math.round(prefs.ttsRate * 100)}%</Text>
      </View>

      <Text style={styles.sectionLabel}>DEFAULTS</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Start in Online mode</Text>
        <Switch
          value={prefs.llmMode === 'online'}
          onValueChange={v => update('llmMode', v ? 'online' : 'local')}
          trackColor={{ true: colors.orange }}
        />
      </View>

      <Text style={styles.sectionLabel}>ONLINE MODE</Text>
      <Text style={styles.hint}>Enter your Groq API key to enable Online mode. Get one free at console.groq.com</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.apiInput}
          value={apiKeyMasked && prefs.groqApiKey ? '••••••••••••••••' : prefs.groqApiKey}
          onFocus={() => setApiKeyMasked(false)}
          onBlur={() => setApiKeyMasked(true)}
          onChangeText={v => update('groqApiKey', v)}
          placeholder="gsk_..."
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.sectionLabel}>MODEL INFO</Text>
      <Text style={styles.hint}>Local: Llama 3.2 3B (on-device, offline)</Text>
      <Text style={styles.hint}>Online: Llama 3.1 8B via Groq (internet required)</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  back: { marginBottom: 24 },
  backArrow: { color: colors.orange, fontSize: 16 },
  sectionLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.textMuted, fontSize: 13, flex: 1 },
  value: { color: colors.textFaint, fontSize: 13 },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 18, marginBottom: 4 },
  apiInput: { flex: 1, color: colors.text, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
});
