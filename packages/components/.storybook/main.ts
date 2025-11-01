import type { StorybookConfig } from '@storybook/react-webpack5';
import webpack from 'webpack';
import path from 'path';

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

    // Add path alias resolution
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@': path.resolve(__dirname, '../src'),
      };

      // Allow .js imports to resolve to .ts/.tsx files
      config.resolve.extensionAlias = {
        '.js': ['.ts', '.tsx', '.js'],
        '.jsx': ['.tsx', '.jsx'],
      };
    }

    // Add PostCSS processing for Tailwind
    const cssRule = config.module?.rules?.find((rule: any) => {
      return rule.test?.toString().includes('css');
    }) as any;

    if (cssRule) {
      cssRule.use = [
        'style-loader',
        'css-loader',
        {
          loader: 'postcss-loader',
          options: {
            postcssOptions: {
              plugins: [
                '@tailwindcss/postcss',
              ],
            },
          },
        },
      ];
    }

    return config;
  },
};
export default config;
