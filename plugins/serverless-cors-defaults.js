'use strict'

const { forEach, isArray, isPlainObject } = require('lodash')

// Adds a shared CORS allow-headers list to every http event that has cors enabled.
//
// The admin-portal sends `x-school-code` on every request, which triggers a CORS
// preflight. Serverless's `cors: true` shorthand emits a fixed default header list
// that does NOT include `x-school-code`, so preflights fail. Rather than editing the
// hundreds of `cors: true` entries across every *-endpoints.yml, this plugin injects
// the full header list (defaults + x-school-code) into each http event before API
// Gateway compiles the OPTIONS (preflight) methods.
class ServerlessCorsDefaults {
  constructor (serverless) {
    this.serverless = serverless
    this.hooks = {
      'before:package:compileFunctions': this.applyCorsDefaults.bind(this),
      'before:deploy:function:packageFunction': this.applyCorsDefaults.bind(this),
    }
  }

  applyCorsDefaults () {
    const fns = this.serverless.service.functions
    if (!isPlainObject(fns)) return

    const headers = [
      'Content-Type',
      'X-Amz-Date',
      'Authorization',
      'X-Api-Key',
      'X-Amz-Security-Token',
      'X-Amz-User-Agent',
      'x-school-code',
    ]

    forEach(fns, (fn) => {
      if (!fn || !isArray(fn.events)) return
      fn.events.forEach((ev) => {
        if (!ev || !isPlainObject(ev.http) || !ev.http.cors) return
        // Preserve any explicit cors object; only ensure origin + the header list.
        const existing = isPlainObject(ev.http.cors) ? ev.http.cors : {}
        ev.http.cors = { origin: '*', ...existing, headers }
      })
    })
  }
}

module.exports = ServerlessCorsDefaults
