import type { StorybookConfig } from '@storybook/react-webpack5';
import webpack from 'webpack';
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../stories/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-onboarding',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  webpackFinal: async (config) => {
    config.plugins?.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    );
    return config;
  },
};
export default config;
