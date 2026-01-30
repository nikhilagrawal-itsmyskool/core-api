// Health Check for a Single Module
// Polls the health endpoint until it responds or times out.

var http = require('http');
var moduleLoader = require('./module-loader');

var MAX_ATTEMPTS = 60;
var RETRY_INTERVAL = 1000;

function parseArgs() {
  var args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node health-module.js <module-name> [--timeout <seconds>]');
    process.exit(1);
  }

  var result = {
    moduleName: args[0],
    maxAttempts: MAX_ATTEMPTS,
  };

  for (var i = 1; i < args.length; i++) {
    if (args[i] === '--timeout' && args[i + 1]) {
      result.maxAttempts = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return result;
}

function checkHealth(port, prefix, callback) {
  var healthUrl = '/' + prefix + '/health';

  var req = http.request({
    hostname: 'localhost',
    port: port,
    path: healthUrl,
    method: 'GET',
    timeout: 2000,
  }, function(res) {
    if (res.statusCode === 200) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });

  req.on('error', function() {
    callback(null, false);
  });

  req.on('timeout', function() {
    req.destroy();
    callback(null, false);
  });

  req.end();
}

function waitForHealth(moduleName, port, prefix, maxAttempts) {
  return new Promise(function(resolve, reject) {
    var attempts = 0;

    function check() {
      attempts++;
      checkHealth(port, prefix, function(err, healthy) {
        if (healthy) {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('Health check failed after ' + maxAttempts + ' attempts'));
        } else {
          setTimeout(check, RETRY_INTERVAL);
        }
      });
    }

    check();
  });
}

function main() {
  var parsed = parseArgs();
  var moduleName = parsed.moduleName;
  var maxAttempts = parsed.maxAttempts;

  var config = moduleLoader.getModule(moduleName);
  if (!config) {
    console.error('Unknown module: ' + moduleName);
    console.error('Make sure the module has a local.config.json file');
    process.exit(1);
  }

  var port = config.httpPort;
  var prefix = config.prefix;

  console.log('Checking health of ' + moduleName + ' at http://localhost:' + port + '/' + prefix + '/health...');

  waitForHealth(moduleName, port, prefix, maxAttempts)
    .then(function() {
      console.log(moduleName + ' is healthy');
      process.exit(0);
    })
    .catch(function(err) {
      console.error(moduleName + ' health check failed: ' + err.message);
      process.exit(1);
    });
}

// Export for use by health-all.js
module.exports = {
  checkHealth: checkHealth,
  waitForHealth: waitForHealth,
};

// Run if called directly
if (require.main === module) {
  main();
}
