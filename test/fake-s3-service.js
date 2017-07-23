
module.exports = function() {
  const objects = []

  return {
    putObject(params, callback) {
      validateParams(params,
                     ['Bucket', 'Key', 'Body'],
                     [], 'putObject')
      objects.push(params)
      callback()
    },

    getObject(params, callback) {
      validateParams(params,
                     ['Bucket', 'Key'],
                     [], 'getObject')
      const object = objects.find(obj =>
        obj.Key === params.Key && obj.Bucket === params.Bucket
      )
      if (object) {
        callback(null, object)
      } else {
        callback({ statusCode: 404 })
      }
    },
  }

  function validateParams(params, mandatoryFields, optionalFields, apiName) {
    const allFields = mandatoryFields.concat(optionalFields)
    const mandis = mandatoryFields.slice()
    Object.keys(params).forEach(key => {
      if (allFields.indexOf(key) === -1) {
        throw "Param key '" + key +  "' is not allowed for the given API " + apiName
      }

      const mandiIndex = mandis.indexOf(key)
      if (mandiIndex >= 0) {
        mandis.splice(mandiIndex, 1)
      }
    })

    if (mandis.length > 0) {
      throw "Param keys: " + mandis.join(",") + " are missing for the given API " + apiName
    }
  }
}
