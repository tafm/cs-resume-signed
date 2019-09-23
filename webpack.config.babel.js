var path = require('path')

var env = process.env.WEBPACK_ENV;
var libraryName = 'cloudStorageSignedResumer';
var fileName = 'cs-resume-signed'
var plugins = [], outputFile;

if (env === 'build') {
  outputFile = fileName + '.min.js';
} else {
  outputFile = fileName + '.js';
}

var config = {
  mode: 'production',
  entry: ['babel-regenerator-runtime', __dirname + '/src/cs-resume-signed.js'],
  // devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, './lib'),
    filename: outputFile,
    library: libraryName,
    libraryTarget: 'umd',
    umdNamedDefine: true,
    globalObject: 'window || this'
  },
  plugins: plugins,
  externals: {
    'xmlhttprequest': {
      commonjs: 'xmlhttprequest',
      commonjs2: 'xmlhttprequest',
      amd: 'xmlhttprequest',
      root: 'window'
    },
    'spark-md5': {
      commonjs: 'spark-md5',
      commonjs2: 'spark-md5',
      amd: 'spark-md5',
      root: 'SparkMD5'
    },
    'nodefilereader': {
      commonjs: 'nodefilereader',
      commonjs2: 'nodefilereader',
      amd: 'nodefilereader',
      root: 'FileReader',
    },
    'node-blob': {
      commonjs: 'node-blob',
      commonjs2: 'node-blob',
      amd: 'node-blob',
      root: 'Blob',
    },
    'q': {
      commonjs: 'q',
      commonjs2: 'q',
      amd: 'q',
      root: 'Q'
    },
    'xmldom': {
      commonjs: 'xmldom',
      commonjs2: 'xmldom',
      amd: 'xmldom',
      root: 'window'
    },
    'fs': {
      commonjs: 'fs',
      commonjs2: 'fs',
    },
    'child_process': {
      commonjs: 'child_process',
      commonjs2: 'child_process',
    }
  },
  module: {
      rules: [
        {
            test: /\.(js)$/,
            exclude: /(node_modules|bower_components)/,
            use: 'babel-loader'
        }
    ]
  }
};

module.exports = config;