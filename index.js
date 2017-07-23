const fs = require('fs')
const AWS = require('aws-sdk')
const extend = require('util')._extend
const async = require('async')

module.exports.deploy = (codePackage, config, callback, logger, lambda, s3) => {
  if (!logger) {
    logger = console.log
  }

  if (!lambda) {
    lambda = createAWSInstance('Lambda', config)
  }

  if (!s3) {
    s3 = createAWSInstance('S3', config)
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

  lambda.getFunction({ FunctionName: params.FunctionName }, (err, data) => {
    fs.readFile(codePackage, (readFileErr, data) => {
      if (readFileErr) {
        return callback('Error reading specified package "'+ codePackage + '"')
      }

      let putObjPromise
      if (config.s3Bucket) {
        putObjPromise = new Promise((resolve, reject) => {
          const s3Key = config.s3Key || params.FunctionName + '.zip'
          s3.putObject({
            Bucket: config.s3Bucket,
            Key: s3Key,
            Body: data,
          }, (err, data) => {
            err ? reject(err) : resolve({
              S3Bucket: config.s3Bucket,
              S3Key: s3Key,
            })
          })
        })
      } else {
        putObjPromise = Promise.resolve({ ZipFile: data })
      }

      putObjPromise.then(codeConfig => {
        if (err) {
          if (err.statusCode === 404) {
            createFunction(codeConfig, callback)
          } else {
            const warning = 'AWS API request failed. '
            warning += 'Check your AWS credentials and permissions.'
            logger(warning)
            callback(err)
          }
        } else {
          updateFunction(codeConfig, callback)
        }
      }).catch(err => {
        const warning = 'AWS S3 request failed: ' + err
        logger(warning)
        callback(err)
      })
    })
  })

  function updateEventSource(eventSource, callback) {
    const params = extend({ FunctionName: config.functionName }, eventSource)

    lambda.listEventSourceMappings({
      FunctionName: params.FunctionName,
      EventSourceArn: params.EventSourceArn,
    }, (err, data) => {
      if (err) {
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

  function updateEventSources(callback) {
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

  function updateFunction(codeConfig, callback) {
    lambda.updateFunctionCode(Object.assign({
      FunctionName: params.FunctionName,
      Publish: isPublish,
    }, codeConfig), (err, data) => {
      if (err) {
        const warning = 'Package upload failed. '
                      + 'Check your iam:PassRole permissions.'
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
  }

  function createFunction(codeConfig, callback) {
    const requestParams = extend({
      Code: codeConfig,
      Runtime: "runtime" in config ? config.runtime : "nodejs4.3",
      Publish: isPublish,
    }, params)

    lambda.createFunction(requestParams, (err, data) => {
      if (err) {
        const warning = 'Create function failed. '
        warning += 'Check your iam:PassRole permissions.'
        logger(warning)
        callback(err)
      } else {
        updateEventSources(callback)
      }
    })
  }
}

function createAWSInstance(name, config) {
  if ("profile" in config) {
    const credentials = new AWS.SharedIniFileCredentials({ profile: config.profile })
    AWS.config.credentials = credentials
  }

  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxy) {
    if (!AWS.config.httpOptions) {
      AWS.config.httpOptions = {}
    }
    const HttpsProxyAgent = require('https-proxy-agent')
    AWS.config.httpOptions.agent = new HttpsProxyAgent(proxy)
  }

  return new AWS[name]({
    region: config.region,
    accessKeyId: "accessKeyId" in config ? config.accessKeyId : "",
    secretAccessKey: "secretAccessKey" in config ? config.secretAccessKey : "",
    sessionToken: "sessionToken" in config ? config.sessionToken : "",
  })
}
