import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={s.container}>
          <Text style={s.title}>Crash Details</Text>
          <ScrollView style={s.scroll}>
            <Text style={s.msg}>{this.state.error.message}</Text>
            <Text style={s.stack}>{this.state.error.stack}</Text>
          </ScrollView>
          <TouchableOpacity style={s.btn} onPress={() => this.setState({ error: null })}>
            <Text style={s.btnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a0000', padding: 20, paddingTop: 60 },
  title: { color: '#ff4444', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  scroll: { flex: 1 },
  msg: { color: '#ffaaaa', fontSize: 14, marginBottom: 12 },
  stack: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  btn: { marginTop: 12, padding: 12, backgroundColor: '#333', borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff' },
});
