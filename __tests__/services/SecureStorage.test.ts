import Keychain from 'react-native-keychain';
import { getApiKey, setApiKey, migrateApiKeyFromSQLite } from '../../src/services/storage/SecureStorage';

const kc = Keychain as unknown as {
  getGenericPassword: jest.Mock;
  setGenericPassword: jest.Mock;
  resetGenericPassword: jest.Mock;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await kc.resetGenericPassword({ service: 'com.tokawalk.apikey' });
});

describe('getApiKey', () => {
  it('returns empty string when nothing is stored', async () => {
    expect(await getApiKey()).toBe('');
  });

  it('returns empty string when the keychain throws', async () => {
    kc.getGenericPassword.mockRejectedValueOnce(new Error('keychain locked'));
    expect(await getApiKey()).toBe('');
  });

  it('round-trips a stored key', async () => {
    await setApiKey('gsk_secret');
    expect(await getApiKey()).toBe('gsk_secret');
  });
});

describe('setApiKey', () => {
  it('resets (deletes) the entry when given an empty string', async () => {
    await setApiKey('gsk_secret');
    await setApiKey('');
    expect(kc.resetGenericPassword).toHaveBeenCalled();
    expect(await getApiKey()).toBe('');
  });
});

describe('migrateApiKeyFromSQLite', () => {
  it('is a no-op when there is no SQLite key', async () => {
    const clear = jest.fn().mockResolvedValue(undefined);
    expect(await migrateApiKeyFromSQLite('', clear)).toBe('');
    expect(clear).not.toHaveBeenCalled();
    expect(kc.setGenericPassword).not.toHaveBeenCalled();
  });

  it('moves the key into the keychain and clears the DB row', async () => {
    const clear = jest.fn().mockResolvedValue(undefined);
    const result = await migrateApiKeyFromSQLite('gsk_from_sqlite', clear);
    expect(result).toBe('gsk_from_sqlite');
    expect(await getApiKey()).toBe('gsk_from_sqlite');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing keychain value and still clears the stale DB row', async () => {
    await setApiKey('gsk_already_here');
    const clear = jest.fn().mockResolvedValue(undefined);
    const result = await migrateApiKeyFromSQLite('gsk_stale_sqlite', clear);
    expect(result).toBe('gsk_already_here');
    expect(await getApiKey()).toBe('gsk_already_here');
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
