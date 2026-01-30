'use strict'

const {
  assign,
  forEach,
  isArray,
  isPlainObject,
  unset,
  merge,
  defaultsDeep,
  omit
} = require('lodash')

class ServerlessMergeConfig {
  constructor (serverless, options) {
    // console.log('ServerlessMergeConfig constructor')
    this.serverless = serverless
    this.options = options

    this.hooks = {
        // Run as early as possible so that variables that rely on the merged
        // data (e.g. self:custom.s3Bucket.*) resolve correctly during
        // Serverless variable population.
        initialize: this.mergeConfig.bind(this),
        'before:package:initialize': this.mergeConfig.bind(this),
        'before:offline:start:init': this.mergeConfig.bind(this),
        'before:invoke:local:invoke': this.mergeConfig.bind(this),
        'before:print:print': this.mergeConfig.bind(this),
        'before:remove:remove': this.mergeConfig.bind(this),
    }
  }

  mergeConfig () {
    // console.log('mergeConfig')
    if (this.alreadyMerged) return
    this.alreadyMerged = true
    // console.log('mergeConfig') 
    this.deepMerge(this.serverless.service)
    this.applyCustomDomainOverrides()
  }

  deepMerge (obj) {
    forEach(obj, (value, key, collection) => {
        // console.log(JSON.stringify(key, value))
      if (isPlainObject(value) || isArray(value)) {
        this.deepMerge(value)
      }
      if (key === '$<<') {
        if (isArray(value)) {
          value.forEach((subValue) => {
            this.assignValue(collection, subValue)
          })
        } else {
          this.assignValue(collection, value)
        }
        unset(obj, key)
      }
    })
  }

  assignValue (collection, value) {
    // console.log('collection', JSON.stringify(collection))
    // console.log('value', JSON.stringify(value))
    if (isPlainObject(value)) {
      // First, fill in missing keys without overwriting existing ones
      defaultsDeep(collection, value, (objVal, srcVal) => {
        if (isArray(objVal)) return objVal  // keep existing array; custom logic handles merge
      })

      // Then, specifically handle arrays so that they are additive rather than overwritten
      forEach(value, (srcVal, key) => {
        // console.log('key', key)
        const destVal = collection[key];

        // If both source and destination are arrays, concatenate them
        if (isArray(srcVal) && isArray(destVal)) {
          // console.log('in isArray')        
          const merged = []
          const seen = new Set()
        
          for (const item of [...destVal, ...srcVal]) {
            // console.log('destVal', JSON.stringify(destVal))
            // console.log('srcVal', JSON.stringify(srcVal))
            const key = isPlainObject(item)
              ? item.rest?.domainName || item.websocket?.domainName || JSON.stringify(item)
              : item // primitives
            // console.log('key', key)
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(item)
          }
        
          collection[key] = merged
          return
        }

        // If both are plain objects, recurse to catch nested arrays
        if (isPlainObject(srcVal) && isPlainObject(destVal)) {
          this.assignValue(destVal, srcVal);
        }
      });
    }
  }

  applyCustomDomainOverrides () {
    const service = this.serverless.service
    const customConfig = service.custom?.customDomain
    if (!customConfig) return
  
    const restOverrides = {
      basePath: customConfig.rest?.basePath ?? customConfig.basePath,
      ...omit(customConfig.rest, ['basePath'])
    }
    const websocketOverrides = {
      basePath: customConfig.websocket?.basePath,
      ...omit(customConfig.websocket, ['basePath'])
    }

    const domains = service.custom.customDomains ?? []

  
    service.custom.customDomains = domains
    .map((entry) => {
      if (entry.rest && restOverrides.basePath != null) {
        entry.rest = { ...entry.rest, ...restOverrides }
        return entry
      }
      if (entry.websocket && websocketOverrides.basePath != null) {
        entry.websocket = { ...entry.websocket, ...websocketOverrides }
        return entry
      }
      return null            // drop entries the module doesn't support
    })
    .filter(Boolean)
  
    delete service.custom.customDomain
  }  

}

module.exports = ServerlessMergeConfig