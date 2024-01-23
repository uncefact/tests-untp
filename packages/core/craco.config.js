const webpack = require('webpack')
const path = require('path')

const ouputDir =
  process.env.REACT_APP_MODE === 'verifier'
    ? 'build/verifier'
    : 'build/explorer'

module.exports = {
  babel: {
    plugins: ['@babel/plugin-syntax-import-assertions'],
  },
  webpack: {
    configure: (webpackConfig, { env, paths }) => {
      paths.appBuild = webpackConfig.output.path = path.resolve(ouputDir)
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
      }
      /* ... */
      return webpackConfig
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
  },
}
