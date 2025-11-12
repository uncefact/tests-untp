import type { StorybookConfig } from '@storybook/react-webpack5';
import webpack from 'webpack';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../stories/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-links',
    '@storybook/addon-onboarding',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  webpackFinal: async (config) => {
    config.plugins?.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      new webpack.DefinePlugin({
        'process.env': JSON.stringify(process.env),
      }),
    );

    // Add path alias resolution
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@': path.resolve(__dirname, '../src'),
        // Ensure single React instance to prevent hook errors
        'react': path.resolve(__dirname, '../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      };

      // Allow .js imports to resolve to .ts/.tsx files
      config.resolve.extensionAlias = {
        '.js': ['.ts', '.tsx', '.js'],
        '.jsx': ['.tsx', '.jsx'],
      };

      // Ensure extensions are resolved
      config.resolve.extensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
    }

    // Add TypeScript loader for .ts/.tsx files
    config.module?.rules?.push({
      test: /\.(ts|tsx)$/,
      use: [
        {
          loader: require.resolve('babel-loader'),
          options: {
            presets: [
              [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
              require.resolve('@babel/preset-typescript'),
            ],
          },
        },
      ],
      exclude: /node_modules/,
    });

    // Add PostCSS processing for Tailwind
    const cssRule = config.module?.rules?.find((rule: unknown) => {
      const r = rule as { test?: RegExp };
      return r.test?.toString().includes('css');
    }) as { use?: unknown[] };

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
