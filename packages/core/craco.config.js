const webpack = require('webpack');

module.exports = {
  babel: {
    presets: ['@babel/preset-react', '@babel/preset-env', '@babel/preset-typescript'],
    plugins: ['@babel/plugin-syntax-import-assertions'],
    loaderOptions: (babelLoaderOptions) => {
      return babelLoaderOptions;
    },
  },
  webpack: {
    configure: (webpackConfig, { env, paths }) => {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
      };
      /* ... */
      return webpackConfig;
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
  },
};
