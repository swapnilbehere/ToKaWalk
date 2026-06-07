import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Preferences } from '../types';
import { colors } from '../constants/colors';
import { getDatabase } from '../services/storage/database';
import { PreferencesRepository } from '../services/storage/PreferencesRepository';
import { getApiKey } from '../services/storage/SecureStorage';
import { useConversationEngine } from '../context/ConversationEngineContext';

export function SettingsScreen() {
  const navigation = useNavigation();
  const { updateGroqApiKey, updateTtsRate, updateVadSensitivity } = useConversationEngine();
  const [prefs, setPrefs] = useState<Omit<Preferences, 'groqApiKey'> | null>(null);
  const [apiKey, setApiKeyState] = useState('');
  const [repo, setRepo] = useState<PreferencesRepository | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState(true);

  useEffect(() => {
    (async () => {
      const db = getDatabase();
      const r = new PreferencesRepository(db);
      setRepo(r);
      const [loadedPrefs, loadedKey] = await Promise.all([r.get(), getApiKey()]);
      setPrefs(loadedPrefs);
      setApiKeyState(loadedKey);
    })();
  }, []);

  const update = async <K extends keyof Omit<Preferences, 'groqApiKey'>>(key: K, value: Omit<Preferences, 'groqApiKey'>[K]) => {
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
          onValueChange={v => { const mode = v ? 'outdoor' : 'indoor'; update('vadSensitivity', mode); updateVadSensitivity(mode); }}
          trackColor={{ true: colors.orange }}
        />
      </View>

      <Text style={styles.sectionLabel}>VOICE</Text>
      <View style={styles.row}>
        <Text style={styles.label}>TTS Speed</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={() => {
              const newRate = Math.max(0.1, Math.round((prefs.ttsRate - 0.1) * 10) / 10);
              update('ttsRate', newRate);
              updateTtsRate(newRate);
            }}
            style={styles.rateBtn}
          >
            <Text style={styles.rateBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.value}>{Math.round(prefs.ttsRate * 100)}%</Text>
          <TouchableOpacity
            onPress={() => {
              const newRate = Math.min(2.0, Math.round((prefs.ttsRate + 0.1) * 10) / 10);
              update('ttsRate', newRate);
              updateTtsRate(newRate);
            }}
            style={styles.rateBtn}
          >
            <Text style={styles.rateBtnText}>+</Text>
          </TouchableOpacity>
        </View>
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
          value={apiKeyMasked && apiKey ? '••••••••••••••••' : apiKey}
          onFocus={() => setApiKeyMasked(false)}
          onBlur={() => setApiKeyMasked(true)}
          onChangeText={v => { updateGroqApiKey(v); setApiKeyState(v); }}
          placeholder="gsk_..."
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.sectionLabel}>MODEL INFO</Text>
      <Text style={styles.hint}>Local: Qwen 2.5 1.5B (on-device, offline)</Text>
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
  rateBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  rateBtnText: { color: colors.textMuted, fontSize: 16, lineHeight: 20 },
});
