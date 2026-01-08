// Module Loader Utility
// Discovers and loads module configurations from modules/*/local.config.json

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, '../../modules');
const CONFIG_FILE = 'local.config.json';
const GATEWAY_PORT = 3000;

function loadModules() {
  const modules = {};

  if (!fs.existsSync(MODULES_DIR)) {
    return modules;
  }

  const folders = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const folder of folders) {
    const configPath = path.join(MODULES_DIR, folder, CONFIG_FILE);

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

function getModule(moduleName) {
  const modules = loadModules();
  return modules[moduleName] || null;
}

function getModulePorts(moduleName) {
  const mod = getModule(moduleName);
  if (!mod) return [];
  return [mod.httpPort, mod.lambdaPort];
}

function getAllPorts() {
  const modules = loadModules();
  const ports = [GATEWAY_PORT];

  for (const config of Object.values(modules)) {
    ports.push(config.httpPort, config.lambdaPort);
  }

  return [...new Set(ports)].sort((a, b) => a - b);
}

function buildGatewayRoutes() {
  const modules = loadModules();
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
  GATEWAY_PORT,
  MODULES_DIR,
};
