module.exports = {
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: ['@babel/plugin-transform-react-jsx'],
            // Set the JSX flag here
            jsxPragma: 'React',
          },
        },
      },
    ],
  },
  // ...
};
