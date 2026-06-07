import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.tokawalk.apikey';
const USERNAME = 'groq';

export async function getApiKey(): Promise<string> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    return result ? result.password : '';
  } catch {
    return '';
  }
}

export async function setApiKey(key: string): Promise<void> {
  if (!key) {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return;
  }
  await Keychain.setGenericPassword(USERNAME, key, { service: SERVICE });
}

// One-time migration: moves a key stored in SQLite plaintext into the Keychain
// and deletes it from the DB. Safe to call repeatedly — no-op once migrated.
export async function migrateApiKeyFromSQLite(
  sqliteKey: string,
  clearFromDB: () => Promise<void>,
): Promise<string> {
  if (!sqliteKey) return '';
  const existing = await getApiKey();
  if (!existing) {
    await setApiKey(sqliteKey);
  }
  await clearFromDB();
  return existing || sqliteKey;
}
