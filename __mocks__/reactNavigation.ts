import React from 'react';
import { View } from 'react-native';

export const NavigationContainer = ({ children }: any) =>
  React.createElement(View, {}, children);

export const useNavigation = () => ({ navigate: jest.fn(), goBack: jest.fn() });
export const useRoute = () => ({ params: {} });

export const createStackNavigator = () => ({
  Navigator: ({ children }: any) => React.createElement(View, {}, children),
  Screen: ({ component: Component }: any) => React.createElement(Component),
});
