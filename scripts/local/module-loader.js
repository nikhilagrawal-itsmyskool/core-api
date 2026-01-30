// Module Loader Utility
// Discovers and loads module configurations from modules/*/local.config.json or prod.config.json

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, '../../modules');

function getConfigFile(stage) {
  if (stage === 'prod') return 'prod.config.json';
  return 'local.config.json';
}

function getGatewayPort(stage) {
  if (stage === 'prod') return 6000;
  return 3000;
}

function loadModules(stage) {
  stage = stage || 'local';
  const configFile = getConfigFile(stage);
  const modules = {};

  if (!fs.existsSync(MODULES_DIR)) {
    return modules;
  }

  const folders = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const folder of folders) {
    const configPath = path.join(MODULES_DIR, folder, configFile);

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        modules[folder] = {
          name: folder,
          path: path.join(MODULES_DIR, folder),
          httpPort: config.httpPort,
          lambdaPort: config.lambdaPort,
          prefix: config.prefix || folder,
        };
      } catch (err) {
        console.error('Error loading config for ' + folder + ': ' + err.message);
      }
    }
  }

  return modules;
}

function getModule(moduleName, stage) {
  const modules = loadModules(stage);
  return modules[moduleName] || null;
}

function getModulePorts(moduleName, stage) {
  const mod = getModule(moduleName, stage);
  if (!mod) return [];
  return [mod.httpPort, mod.lambdaPort];
}

function getAllPorts(stage) {
  const modules = loadModules(stage);
  const gatewayPort = getGatewayPort(stage);
  const ports = [gatewayPort];

  for (const config of Object.values(modules)) {
    ports.push(config.httpPort, config.lambdaPort);
  }

  return [...new Set(ports)].sort((a, b) => a - b);
}

function buildGatewayRoutes(stage) {
  const modules = loadModules(stage);
  const routes = {};

  for (const [name, config] of Object.entries(modules)) {
    routes['/' + config.prefix] = {
      target: 'http://localhost:' + config.httpPort,
      name: name,
    };
  }

  return routes;
}

module.exports = {
  loadModules,
  getModule,
  getModulePorts,
  getAllPorts,
  buildGatewayRoutes,
  getGatewayPort,
  getConfigFile,
  MODULES_DIR,
};
