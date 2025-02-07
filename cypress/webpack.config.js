const webpack = require('webpack');

module.exports = {
  target: 'node',
  externalsPresets: {
    node: true,
  },
  resolve: {
    fallback: {
      path: require.resolve('path-browserify'),
      os: false,
      fs: false,
      path: false,
      module: false,
      child_process: false,
    },
    extensions: ['.jsx', '.js', '.tsx', '.ts'],
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    }),
  ],
  module: {
    rules: [
      {
        test: /\.js$|jsx/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: ['@babel/preset-env', '@babel/preset-react'],
          plugins: [
            // we could optionally insert this plugin
            // only if the code coverage flag is on
            'istanbul',
          ],
        },
      },
      {
        test: /\.ts$|tsx/,
        exclude: [/node_modules/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              // skip typechecking for speed
              // transpileOnly: true,
            },
          },
        ],
      },
    ],
  },
};
