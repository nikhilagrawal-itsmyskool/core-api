const path = require('path');
const slsw = require('serverless-webpack');
var nodeExternals = require('webpack-node-externals');

module.exports = {
    mode: slsw.lib.webpack.isLocal ? 'development' : 'production',
    entry: slsw.lib.entries,
    stats: 'errors-only', // Minimal output
    externalsPresets: { node: true },
    externals: [nodeExternals(), "pg", "jsonwebtoken"], // Remove unused externals for minimalism
    resolve: {
        extensions: ['.ts', '.tsx'], // Only include TypeScript file extensions
    },
    output: {
        libraryTarget: 'commonjs',
        path: path.join(process.cwd(), '.webpack'),
        filename: '[name].js',
    },
    module: {
        rules: [
            { test: /\.tsx?$/, loader: 'ts-loader', exclude: [
                path.resolve(__dirname, 'node_modules'),
                path.resolve(__dirname, '.serverless'),
                path.resolve(__dirname, '.webpack'),
            ]}
        ],
    },
    optimization: {
        minimize: true, // Enable minification in production
    }
};
