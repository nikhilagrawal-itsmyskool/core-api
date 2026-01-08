// Kill Processes on Module Ports
// Uses PowerShell to find and kill processes using module ports.

const { execSync } = require('child_process');
const { getModulePorts, getAllPorts } = require('./module-loader');

function getPortsFromArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node kill-ports.js --<module>|--all|<port1> <port2> ...');
    process.exit(0);
  }

  if (args[0] === '--all') {
    return getAllPorts();
  }

  if (args[0].startsWith('--')) {
    const moduleName = args[0].substring(2);
    const ports = getModulePorts(moduleName);
    if (ports.length === 0) {
      console.error('Unknown module: ' + moduleName);
      process.exit(1);
    }
    return ports;
  }

  return args.map(function(arg) { return parseInt(arg, 10); }).filter(function(p) { return !isNaN(p); });
}

function findProcessOnPort(port) {
  try {
    var cmd = 'powershell -Command "(Get-NetTCPConnection -LocalPort ' + port + ' -ErrorAction SilentlyContinue | Where-Object State -eq \'Listen\').OwningProcess"';
    var result = execSync(cmd, { encoding: 'utf8' }).trim();

    if (result) {
      var lines = result.split('\n');
      var pids = [];
      for (var i = 0; i < lines.length; i++) {
        var p = lines[i].trim();
        if (p && p !== '0' && pids.indexOf(p) === -1) {
          pids.push(p);
        }
      }
      return pids;
    }
  } catch (err) {
    // Port not in use
  }
  return [];
}

function killProcess(pid) {
  try {
    execSync('powershell -Command "Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue"', { encoding: 'utf8' });
    return true;
  } catch (err) {
    return false;
  }
}

function main() {
  var ports = getPortsFromArgs();
  var killedPids = [];

  for (var i = 0; i < ports.length; i++) {
    var port = ports[i];
    var pids = findProcessOnPort(port);

    for (var j = 0; j < pids.length; j++) {
      var pid = pids[j];
      if (killedPids.indexOf(pid) === -1) {
        var killed = killProcess(pid);
        if (killed) {
          console.log('Killed process ' + pid + ' on port ' + port);
          killedPids.push(pid);
        }
      }
    }
  }

  if (killedPids.length === 0) {
    console.log('Ports ' + ports.join(', ') + ' are free');
  }
}

main();
