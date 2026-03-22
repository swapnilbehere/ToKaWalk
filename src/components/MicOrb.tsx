import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { ConversationState } from '../types';
import { colors } from '../constants/colors';

interface Props { state: ConversationState; }

export function MicOrb({ state }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [state]);

  const borderColor =
    state === 'listening' ? colors.green :
    state === 'speaking' ? colors.orange :
    colors.borderActive;

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.ring2, { borderColor: borderColor + '22', transform: [{ scale: pulse }] }]} />
      <Animated.View style={[styles.ring1, { borderColor: borderColor + '44', transform: [{ scale: pulse }] }]} />
      <View style={[styles.orb, { borderColor }]}>
        <View style={styles.mic} />
      </View>
    </View>
  );
}

const ORB = 110;
const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center', width: ORB + 40, height: ORB + 40 },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ring1: { position: 'absolute', width: ORB + 18, height: ORB + 18, borderRadius: (ORB + 18) / 2, borderWidth: 2 },
  ring2: { position: 'absolute', width: ORB + 36, height: ORB + 36, borderRadius: (ORB + 36) / 2, borderWidth: 1 },
  mic: { width: 24, height: 24, borderRadius: 4, backgroundColor: colors.textMuted },
});
