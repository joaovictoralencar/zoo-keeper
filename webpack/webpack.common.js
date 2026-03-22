const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: ['./src/scripts/game.ts'],
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: '[name].bundle.js',
    chunkFilename: '[name].chunk.js'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: {
      three: path.resolve(__dirname, '../node_modules/three')
    }
  },
  module: {
    rules: [{ test: /\.tsx?$/, include: path.join(__dirname, '../src'), loader: 'ts-loader' }]
  },
  optimization: {
    splitChunks: {
      cacheGroups: {
        defaultVendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          filename: '[name].bundle.js'
        }
      }
    }
  },
  plugins: [
    new HtmlWebpackPlugin({ gameName: 'Zoo Keeper Prototype', template: 'src/index.html' }),
    new CopyWebpackPlugin({ patterns: [{ from: 'src/assets', to: 'assets' }] })
  ]
}
