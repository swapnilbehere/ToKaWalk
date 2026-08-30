const store: Record<string, string> = {};

export const getGenericPassword = jest.fn(async (opts?: { service?: string }) => {
  const key = opts?.service ?? '__default__';
  if (store[key] === undefined) return false;
  return { username: 'groq', password: store[key], service: key };
});

export const setGenericPassword = jest.fn(
  async (_username: string, password: string, opts?: { service?: string }) => {
    const key = opts?.service ?? '__default__';
    store[key] = password;
    return true;
  },
);

export const resetGenericPassword = jest.fn(async (opts?: { service?: string }) => {
  const key = opts?.service ?? '__default__';
  delete store[key];
  return true;
});

const Keychain = { getGenericPassword, setGenericPassword, resetGenericPassword };
export default Keychain;
