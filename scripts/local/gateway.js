// Local API Gateway Proxy
// Routes requests to different modules based on path prefix.

var http = require('http');
var url = require('url');
var moduleLoader = require('./module-loader');

function parseArgs() {
  var args = process.argv.slice(2);
  var stage = 'local';

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      stage = args[i + 1];
      i++;
    } else if (args[i] === '-s' && args[i + 1]) {
      stage = args[i + 1];
      i++;
    }
  }

  return { stage: stage };
}

var parsed = parseArgs();
var STAGE = parsed.stage;
var ROUTES = moduleLoader.buildGatewayRoutes(STAGE);
var GATEWAY_PORT = moduleLoader.getGatewayPort(STAGE);

function findRoute(pathname) {
  var prefixes = Object.keys(ROUTES);
  for (var i = 0; i < prefixes.length; i++) {
    var prefix = prefixes[i];
    if (pathname.indexOf(prefix) === 0) {
      return {
        target: ROUTES[prefix].target,
        name: ROUTES[prefix].name,
        path: pathname  // Keep full path - module expects prefix
      };
    }
  }
  return null;
}

function proxyRequest(req, res, route) {
  var targetUrl = url.parse(route.target);

  var options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: route.path + (url.parse(req.url).search || ''),
    method: req.method,
    headers: Object.assign({}, req.headers, {
      host: targetUrl.hostname + ':' + targetUrl.port
    }),
  };

  var proxyReq = http.request(options, function(proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', function(err) {
    console.error('[' + route.name + '] Proxy error:', err.message);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Module "' + route.name + '" is not running on ' + route.target,
      }
    }));
  });

  req.pipe(proxyReq);
}

var server = http.createServer(function(req, res) {
  var pathname = url.parse(req.url).pathname;
  var route = findRoute(pathname);

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: 'Unknown route',
      },
      availableRoutes: Object.keys(ROUTES),
    }));
    return;
  }

  console.log('[' + route.name + '] ' + req.method + ' ' + pathname + ' -> ' + route.target + route.path);
  proxyRequest(req, res, route);
});

server.listen(GATEWAY_PORT, function() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Local API Gateway Started                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Stage: ' + STAGE.padEnd(53) + '║');
  console.log('║  Gateway URL: http://localhost:' + GATEWAY_PORT + '                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Routes:                                                     ║');
  var prefixes = Object.keys(ROUTES);
  for (var i = 0; i < prefixes.length; i++) {
    var prefix = prefixes[i];
    var config = ROUTES[prefix];
    var padding = '                    '.substring(0, 20 - prefix.length);
    console.log('║    ' + prefix + '/*' + padding + '-> ' + config.target.padEnd(25) + '║');
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
});

process.on('SIGINT', function() {
  console.log('\nShutting down gateway...');
  server.close(function() {
    process.exit(0);
  });
});

module.exports = { ROUTES: ROUTES, GATEWAY_PORT: GATEWAY_PORT, STAGE: STAGE };
