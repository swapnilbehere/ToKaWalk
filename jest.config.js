module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
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
  testMatch: ['**/__tests__/**/*.(ts|tsx|js)'],
  moduleNameMapper: {
    'react-native-vosk': '<rootDir>/__mocks__/vosk.ts',
    'react-native-fs': '<rootDir>/__mocks__/rnfs.ts',
    'react-native-zip-archive': '<rootDir>/__mocks__/zipArchive.ts',
    'llama.rn': '<rootDir>/__mocks__/llamarn.ts',
    '@react-native-voice/voice': '<rootDir>/__mocks__/voice.ts',
    'react-native-tts': '<rootDir>/__mocks__/tts.ts',
    '@op-engineering/op-sqlite': '<rootDir>/__mocks__/sqlite.ts',
    'react-native-gesture-handler': '<rootDir>/__mocks__/gestureHandler.ts',
    '@react-navigation/native': '<rootDir>/__mocks__/reactNavigation.ts',
    '@react-navigation/stack': '<rootDir>/__mocks__/reactNavigation.ts',
  },
};
