// Start All Modules Locally
// Starts all serverless modules and the API gateway proxy for local development.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { loadModules, GATEWAY_PORT } = require('./module-loader');

function parseArgs() {
  var args = process.argv.slice(2);
  var modules = loadModules();

  var result = {
    stage: 'dev',
    modules: Object.keys(modules),
  };

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      result.stage = args[i + 1];
      i++;
    } else if (args[i] === '--modules' && args[i + 1]) {
      result.modules = args[i + 1].split(',').map(function(m) { return m.trim(); });
      i++;
    }
  }

  return result;
}

var colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

var moduleColors = {
  gateway: colors.green,
  auth: colors.blue,
  medical: colors.magenta,
  sample: colors.cyan,
};

function colorLog(module, message) {
  var color = moduleColors[module] || colors.reset;
  var timestamp = new Date().toLocaleTimeString();
  console.log(color + '[' + timestamp + '] [' + module + ']' + colors.reset + ' ' + message);
}

// Poll health endpoint until it responds
function waitForHealth(port, prefix, maxAttempts) {
  return new Promise(function(resolve, reject) {
    var attempts = 0;
    var healthUrl = '/' + prefix + '/health';

    function check() {
      attempts++;
      var req = http.request({
        hostname: 'localhost',
        port: port,
        path: healthUrl,
        method: 'GET',
        timeout: 2000,
      }, function(res) {
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });

      req.on('error', function() {
        retry();
      });

      req.on('timeout', function() {
        req.destroy();
        retry();
      });

      req.end();
    }

    function retry() {
      if (attempts >= maxAttempts) {
        reject(new Error('Health check failed after ' + maxAttempts + ' attempts'));
      } else {
        setTimeout(check, 1000);
      }
    }

    check();
  });
}

function startModule(name, config, stage) {
  return new Promise(function(resolve, reject) {
    var args = [
      'serverless', 'offline', 'start',
      '--httpPort', config.httpPort.toString(),
      '--lambdaPort', config.lambdaPort.toString(),
      '--noPrependStageInUrl',
      '--noAuth',
      '--stage', stage,
      '--prefix', config.prefix,
    ];

    colorLog(name, 'Starting on port ' + config.httpPort + '...');

    var proc = spawn('npx', args, {
      cwd: config.path,
      shell: true,
      stdio: 'inherit',
    });

    proc.on('error', function(err) {
      colorLog(name, colors.red + 'Failed to start: ' + err.message + colors.reset);
      reject(err);
    });

    proc.on('exit', function(code) {
      if (code !== 0 && code !== null) {
        colorLog(name, colors.red + 'Exited with code ' + code + colors.reset);
      }
    });

    // Wait for health endpoint to respond
    waitForHealth(config.httpPort, config.prefix, 60)
      .then(function() {
        colorLog(name, 'Ready on http://localhost:' + config.httpPort);
        resolve(proc);
      })
      .catch(function(err) {
        colorLog(name, colors.red + 'Health check failed: ' + err.message + colors.reset);
        proc.kill();
        reject(err);
      });
  });
}

function startGateway() {
  return new Promise(function(resolve) {
    var gatewayPath = path.join(__dirname, 'gateway.js');

    var proc = spawn('node', [gatewayPath], {
      cwd: path.join(__dirname, '../..'),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', function(data) {
      console.log(data.toString());
      if (data.toString().indexOf('Gateway URL') !== -1) {
        resolve(proc);
      }
    });

    proc.stderr.on('data', function(data) {
      console.error(data.toString());
    });

    return proc;
  });
}

async function main() {
  var parsed = parseArgs();
  var stage = parsed.stage;
  var selectedModuleNames = parsed.modules;
  var allModules = loadModules();

  var invalidModules = selectedModuleNames.filter(function(m) { return !allModules[m]; });
  if (invalidModules.length > 0) {
    console.error(colors.red + 'Unknown modules: ' + invalidModules.join(', ') + colors.reset);
    console.error('Available modules: ' + Object.keys(allModules).join(', '));
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Starting Local Development Environment             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Stage: ' + stage.padEnd(53) + '║');
  console.log('║  Modules: ' + selectedModuleNames.join(', ').padEnd(51) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  var processes = [];

  for (var i = 0; i < selectedModuleNames.length; i++) {
    var moduleName = selectedModuleNames[i];
    try {
      var proc = await startModule(moduleName, allModules[moduleName], stage);
      processes.push({ name: moduleName, proc: proc });
    } catch (err) {
      console.error(colors.red + 'Failed to start ' + moduleName + ': ' + err.message + colors.reset);
    }
  }

  colorLog('gateway', 'Starting API Gateway...');
  var gatewayProc = await startGateway();
  processes.push({ name: 'gateway', proc: gatewayProc });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    All Services Running                      ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  API Gateway: http://localhost:' + GATEWAY_PORT + '                           ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  for (var j = 0; j < selectedModuleNames.length; j++) {
    var modName = selectedModuleNames[j];
    var config = allModules[modName];
    console.log('║  /' + config.prefix.padEnd(10) + ' → http://localhost:' + config.httpPort + '                      ║');
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Press Ctrl+C to stop all services                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  function shutdown() {
    console.log('\n\nShutting down all services...');
    processes.forEach(function(item) {
      colorLog(item.name, 'Stopping...');
      item.proc.kill('SIGTERM');
    });
    setTimeout(function() {
      process.exit(0);
    }, 2000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  setInterval(function() {}, 1000);
}

main().catch(function(err) {
  console.error(colors.red + 'Error: ' + err.message + colors.reset);
  process.exit(1);
});
