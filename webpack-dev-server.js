const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const path = require('path');

const config = {
  mode: 'development',
  entry: path.resolve(__dirname, '../FRONTEND/src/index.js'),
  output: {
    path: path.resolve(__dirname, '../FRONTEND/build'),
    filename: 'bundle.js',
    publicPath: '/'
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react', '@babel/preset-env'],
            plugins: ['@babel/plugin-proposal-class-properties']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader']
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource'
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    alias: {
      components: path.resolve(__dirname, '../FRONTEND/src/components'),
      layouts: path.resolve(__dirname, '../FRONTEND/src/layouts'),
      views: path.resolve(__dirname, '../FRONTEND/src/views'),
      assets: path.resolve(__dirname, '../FRONTEND/src/assets')
    }
  },
  devServer: {
    static: {
      directory: path.resolve(__dirname, '../FRONTEND/public')
    },
    historyApiFallback: true,
    port: 3000,
    hot: true,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
};

const compiler = webpack(config);
const server = new WebpackDevServer(config.devServer, compiler);

server.start(3000, 'localhost', () => {
  console.log('🎨 Horizon UI Framework running on http://localhost:3000');
  console.log('📱 React Hot Reload enabled');
  console.log('🔗 API Proxy: /api -> http://localhost:4000');
});