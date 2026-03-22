module.exports = {
  preset: 'react-native',
  setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  testPathPattern: '__tests__',
  moduleNameMapper: {
    '@picovoice/porcupine-react-native': '<rootDir>/__mocks__/porcupine.ts',
    'llama.rn': '<rootDir>/__mocks__/llamarn.ts',
    '@react-native-voice/voice': '<rootDir>/__mocks__/voice.ts',
    'react-native-tts': '<rootDir>/__mocks__/tts.ts',
    'react-native-sqlite-storage': '<rootDir>/__mocks__/sqlite.ts',
  },
};
