import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeScreen } from '../../src/screens/HomeScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe('HomeScreen', () => {
  it('renders all 4 session modes', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('⚡ Just Walk')).toBeTruthy();
    expect(getByText('🧠 Brain Dump')).toBeTruthy();
    expect(getByText('📔 Journal')).toBeTruthy();
    expect(getByText('🎓 Learn & Discuss')).toBeTruthy();
  });

  it('navigates to WalkMode on Start Walk press', () => {
    const { getByText } = render(<HomeScreen />);
    fireEvent.press(getByText('Start Walk'));
    expect(mockNavigate).toHaveBeenCalledWith('WalkMode', { mode: 'just-walk' });
  });
});
