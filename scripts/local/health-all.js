// Health Check for All Modules
// Uses health-module to check each module's health endpoint.

var moduleLoader = require('./module-loader');
var healthModule = require('./health-module');

var MAX_ATTEMPTS = 60;

function parseArgs() {
  var args = process.argv.slice(2);

  var result = {
    maxAttempts: MAX_ATTEMPTS,
    stage: 'local',
  };

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--timeout' && args[i + 1]) {
      result.maxAttempts = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--stage' && args[i + 1]) {
      result.stage = args[i + 1];
      i++;
    } else if (args[i] === '-s' && args[i + 1]) {
      result.stage = args[i + 1];
      i++;
    }
  }

  return result;
}

async function main() {
  var parsed = parseArgs();
  var maxAttempts = parsed.maxAttempts;
  var stage = parsed.stage;

  var modules = moduleLoader.loadModules(stage);
  var moduleNames = Object.keys(modules);

  if (moduleNames.length === 0) {
    console.error('No modules found for stage: ' + stage);
    process.exit(1);
  }

  console.log('Stage: ' + stage);
  console.log('Checking health of all modules: ' + moduleNames.join(', '));

  var failed = [];

  for (var i = 0; i < moduleNames.length; i++) {
    var moduleName = moduleNames[i];
    var config = modules[moduleName];

    console.log('Checking ' + moduleName + ' at http://localhost:' + config.httpPort + '/' + config.prefix + '/health...');

    try {
      await healthModule.waitForHealth(moduleName, config.httpPort, config.prefix, maxAttempts);
      console.log(moduleName + ' is healthy');
    } catch (err) {
      console.error(moduleName + ' health check failed: ' + err.message);
      failed.push(moduleName);
    }
  }

  if (failed.length > 0) {
    console.error('\nFailed modules: ' + failed.join(', '));
    process.exit(1);
  }

  console.log('\nAll modules are healthy');
  process.exit(0);
}

main();
