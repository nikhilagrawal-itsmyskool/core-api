'use strict'

const { forEach, isArray, isPlainObject } = require('lodash')

// Attaches the shared `verify-token` Lambda authorizer to every http event in a
// module, EXCEPT exempt paths (e.g. `health`). This is how the API authorizer is
// rolled out module-by-module without editing hundreds of *-endpoints.yml entries:
// add this plugin to a module's `plugins:` list and it protects all its routes.
//
// Config (from `custom.authorizer`, supplied via global-config):
//   arn:         ARN of the verify-token authorizer Lambda (in the auth stack)
//   exemptPaths: route paths to leave public (default ['health'])
//
// A TOKEN authorizer with identitySource=Authorization means API Gateway returns
// 401 for a missing header before even invoking the authorizer; an invalid/expired
// token makes verify-token return Unauthorized -> 401. Both get CORS headers via the
// DEFAULT_4XX GatewayResponse (global-config), so the browser sees a clean 401 and
// the admin-portal interceptor redirects to login.
class ServerlessAuthorizer {
  constructor (serverless) {
    this.serverless = serverless
    this.hooks = {
      'before:package:compileFunctions': this.apply.bind(this),
      'before:deploy:function:packageFunction': this.apply.bind(this),
    }
  }

  apply () {
    const svc = this.serverless.service
    const cfg = (svc.custom && svc.custom.authorizer) || {}
    const arn = cfg.arn
    if (!arn) {
      this.serverless.cli.log('[authorizer] custom.authorizer.arn not set — skipping (routes left public)')
      return
    }
    // Base exempt paths (global) + any module-local additions (custom.authorizerExtraExempt).
    // Module-local is a separate key so it doesn't fight the global-config custom merge —
    // e.g. communication exempts its external provider webhook.
    const extra = svc.custom && svc.custom.authorizerExtraExempt
    const exempt = new Set(
      [...(cfg.exemptPaths || ['health']), ...(Array.isArray(extra) ? extra : [])]
        .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    )
    const fns = svc.functions
    if (!isPlainObject(fns)) return

    let protectedCount = 0
    const exempted = []
    forEach(fns, (fn) => {
      if (!fn || !isArray(fn.events)) return
      fn.events.forEach((ev) => {
        if (!ev || !isPlainObject(ev.http)) return
        const path = String(ev.http.path || '').replace(/^\/+|\/+$/g, '')
        if (exempt.has(path)) { exempted.push(path); return }
        if (ev.http.authorizer) return // respect an explicit authorizer if present
        ev.http.authorizer = {
          arn,
          type: 'token',
          identitySource: 'method.request.header.Authorization',
          resultTtlInSeconds: 0,
        }
        protectedCount++
      })
    })
    this.serverless.cli.log(
      `[authorizer] protected ${protectedCount} route(s); exempt: [${[...new Set(exempted)].join(', ') || 'none'}]`
    )
  }
}

module.exports = ServerlessAuthorizer
