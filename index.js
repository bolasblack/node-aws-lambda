const fs = require('fs')
const AWS = require('aws-sdk')
const extend = require('util')._extend
const async = require('async')

module.exports.deploy = (codePackage, config, callback, logger, lambda) => {
  if (!logger) {
    logger = console.log
  }

  if (!lambda) {
    if ("profile" in config) {
      const credentials = new AWS.SharedIniFileCredentials({profile: config.profile})
      AWS.config.credentials = credentials
    }

    if (process.env.HTTPS_PROXY) {
      if (!AWS.config.httpOptions) {
        AWS.config.httpOptions = {}
      }
      const HttpsProxyAgent = require('https-proxy-agent')
      AWS.config.httpOptions.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY)
    }

    lambda = new AWS.Lambda({
      region: config.region,
      accessKeyId: "accessKeyId" in config ? config.accessKeyId : "",
      secretAccessKey: "secretAccessKey" in config ? config.secretAccessKey : "",
      sessionToken: "sessionToken" in config ? config.sessionToken : "",
    })
  }

  const params = {
    FunctionName: config.functionName,
    Description: config.description,
    Handler: config.handler,
    Role: config.role,
    Timeout: config.timeout,
    MemorySize: config.memorySize,
  }
  if (config.vpc) params.VpcConfig = config.vpc
  const isPublish = (config.publish === true)

  const updateEventSource = (eventSource, callback) => {
    const params = extend({
      FunctionName: config.functionName
    }, eventSource)

    lambda.listEventSourceMappings({
      FunctionName: params.FunctionName,
      EventSourceArn: params.EventSourceArn,
    }, (err, data) => {
      if(err) {
        logger("List event source mapping failed, please make sure you have permission")
        callback(err)
      } else {
        if (data.EventSourceMappings.length === 0) {
          lambda.createEventSourceMapping(params, (err, data) => {
            if(err) {
              logger("Failed to create event source mapping!")
              callback(err)
            } else {
              callback()
            }
          })
        } else {
          async.eachSeries(data.EventSourceMappings, (mapping, iteratorCallback) => {
            lambda.updateEventSourceMapping({
              UUID: mapping.UUID,
              BatchSize: params.BatchSize,
            }, iteratorCallback)
          }, err => {
            if (err) {
              logger("Update event source mapping failed")
              callback(err)
            } else {
              callback()
            }
          })
        }
      }
    })
  }

  const updateEventSources = callback => {
    let eventSources

    if (!config.eventSource) {
      callback()
      return
    }

    eventSources = Array.isArray(config.eventSource) ? config.eventSource : [ config.eventSource ]

    async.eachSeries(
      eventSources,
      updateEventSource,
      err => { callback(err) },
    )
  }

  const updateFunction = callback => {
    fs.readFile(codePackage, (err, data) => {
      if (err) {
        return callback('Error reading specified package "'+ codePackage + '"')
      }

      lambda.updateFunctionCode({
        FunctionName: params.FunctionName,
        ZipFile: data,
        Publish: isPublish,
      }, (err, data) => {
        if (err) {
          const warning = 'Package upload failed. '
          warning += 'Check your iam:PassRole permissions.'
          logger(warning)
          callback(err)
        } else {
          lambda.updateFunctionConfiguration(params, (err, data) => {
            if (err) {
              const warning = 'Update function configuration failed. '
              logger(warning)
              callback(err)
            } else {
              updateEventSources(callback)
            }
          })
        }
      })
    })
  }

  const createFunction = callback => {
    fs.readFile(codePackage, (err, data) => {
      if (err) {
        return callback('Error reading specified package "'+ codePackage + '"')
      }

      params['Code'] = { ZipFile: data }
      params['Runtime'] = "runtime" in config ? config.runtime : "nodejs4.3"
      params['Publish'] = isPublish
      lambda.createFunction(params, (err, data) => {
        if (err) {
          const warning = 'Create function failed. '
          warning += 'Check your iam:PassRole permissions.'
          logger(warning)
          callback(err)
        } else {
          updateEventSources(callback)
        }
      })
    })
  }

  lambda.getFunction({ FunctionName: params.FunctionName }, (err, data) => {
    if (err) {
      if (err.statusCode === 404) {
        createFunction(callback)
      } else {
        const warning = 'AWS API request failed. '
        warning += 'Check your AWS credentials and permissions.'
        logger(warning)
        callback(err)
      }
    } else {
      updateFunction(callback)
    }
  })
}
