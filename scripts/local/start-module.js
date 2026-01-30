// Start a Single Module
// Starts a serverless module using its local.config.json configuration.

var spawn = require('child_process').spawn;
var execSync = require('child_process').execSync;
var moduleLoader = require('./module-loader');

function parseArgs() {
  var args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node start-module.js <module-name> [--kill]');
    process.exit(1);
  }

  return {
    moduleName: args[0],
    killFirst: args.indexOf('--kill') !== -1,
    stage: 'local',
  };
}

function killPortProcess(port) {
  try {
    var cmd = 'powershell -Command "(Get-NetTCPConnection -LocalPort ' + port + ' -ErrorAction SilentlyContinue | Where-Object State -eq \'Listen\').OwningProcess"';
    var result = execSync(cmd, { encoding: 'utf8' }).trim();

    if (result) {
      var lines = result.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var pid = lines[i].trim();
        if (pid && pid !== '0') {
          try {
            execSync('powershell -Command "Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue"', { encoding: 'utf8' });
            console.log('Killed process ' + pid + ' on port ' + port);
          } catch (err) {
            // Ignore
          }
        }
      }
    }
  } catch (err) {
    // Port not in use
  }
}

function main() {
  var parsed = parseArgs();
  var moduleName = parsed.moduleName;
  var killFirst = parsed.killFirst;
  var stage = parsed.stage;

  var config = moduleLoader.getModule(moduleName);
  if (!config) {
    console.error('Unknown module: ' + moduleName);
    console.error('Make sure the module has a local.config.json file');
    process.exit(1);
  }

  if (killFirst) {
    console.log('Cleaning up ports ' + config.httpPort + ', ' + config.lambdaPort + '...');
    killPortProcess(config.httpPort);
    killPortProcess(config.lambdaPort);
  }

  var args = [
    'serverless', 'offline', 'start',
    '--httpPort', config.httpPort.toString(),
    '--lambdaPort', config.lambdaPort.toString(),
    '--noPrependStageInUrl',
    '--noAuth',
    '--stage', stage,
    '--prefix', config.prefix,
  ];

  console.log('Starting ' + moduleName + ' on port ' + config.httpPort + '...');

  var proc = spawn('npx', args, {
    cwd: config.path,
    shell: true,
    stdio: 'inherit',
  });

  proc.on('error', function(err) {
    console.error('Failed to start: ' + err.message);
    process.exit(1);
  });

  proc.on('exit', function(code) {
    process.exit(code || 0);
  });
}

main();
