/**
 * React Native autolinking overrides.
 *
 * @react-native-voice/voice@3.2.4 ships its Java in the `com.wenkesj.voice`
 * package, but the patched Gradle `namespace` is `com.reactnativevoice`.
 * RN 0.84 autolinking derives the package import path from the namespace,
 * so the generated PackageList.java references a class that does not exist
 * (`com.reactnativevoice.VoicePackage`). Pin the real class explicitly.
 */
module.exports = {
  dependencies: {
    '@react-native-voice/voice': {
      platforms: {
        android: {
          packageImportPath: 'import com.wenkesj.voice.VoicePackage;',
          packageInstance: 'new VoicePackage()',
        },
      },
    },
  },
};
