

(function( root, factory ) {
  if( typeof define === 'function' && define.amd ) {
    define('cloudStorageSignedResumer', [ 'xmlhttprequest', 'SparkMD5', 'Q', 'FileReader', 'Blob', 'DOMparser'], factory );
  }
  else if( typeof exports === 'object' ) {
    module.exports = factory(require('xmlhttprequest').XMLHttpRequest, require('spark-md5'), require('q'), require('nodefilereader'), require('node-blob'), require('xmldom').DOMParser)
  }
  else {
    root.cloudStorageSignedResumer = factory( XMLHttpRequest, SparkMD5, Q, FileReader, Blob, DOMParser)
  }
})(this, function(XMLHttpRequest, SparkMD5, Q, FileReader, Blob, DOMParser) {

  function getArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      var reader = new FileReader()

      reader.onload = function(loadedEvent) {
          resolve(loadedEvent.target.result)
      }

      reader.onerror = function(e) {
        reject(e)
      }

      reader.readAsArrayBuffer(file)
    })
  }

  function calculateMD5Hash(file, bufferSize) {
    var def = Q.defer();

    var fileReader = new FileReader();
    var fileSlicer = typeof File !== 'undefined' ? (File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice) : {call (file, start, end) {
      // return file
      // console.log(Blob.prototype.slice.call)
      // console.log(teste)

      let blob = Blob.prototype.slice.call(file, start, end)
      blob.name = file.name
      blob.size = end - start
      blob.type = file.type
      return blob
    }}
    var hashAlgorithm = new SparkMD5();
    var totalParts = Math.ceil(file.size / bufferSize);
    var currentPart = 0;
    var startTime = new Date().getTime();
  
    fileReader.onload = function(e) {
      // console.log(e.target.result[0])
      currentPart += 1;
  
      def.notify({
        currentPart: currentPart,
        totalParts: totalParts
      });
  
      var buffer = e.target.result;

      hashAlgorithm.appendBinary(buffer);
  
      if (currentPart < totalParts) {
        processNextPart();
        return;
      }
  
      def.resolve({
        hashResult: hashAlgorithm.end(),
        duration: new Date().getTime() - startTime
      });
    };
  
    fileReader.onerror = function(e) {
      def.reject(e);
    };
  
    function processNextPart() {
      var start = currentPart * bufferSize;
      var end = Math.min(start + bufferSize, file.size);
      fileReader.readAsBinaryString(fileSlicer.call(file, start, end), currentPart);
      // let fr = new FileReader()
      // fr.onerror = fileReader.onerror
      // fr.onload = fileReader.onload
      // fileReader = fr
    }
  
    processNextPart();
    return def.promise;
  }

  const bufferSize = Math.pow(1024, 2) * 2 // 10MB
  const md5Promise = function (file, {onProgress} = {}) {
    return new Promise((resolve, reject) => {
      calculateMD5Hash(file, bufferSize).then(
        function(result) {
          resolve(result)
        },
        function(err) {
          reject(err)
        },
        function(progress) {
          if (onProgress && typeof onProgress === 'function') {
            onprogress({
              'currentPart': progress.currentPart,
              'totalParts': progress.totalParts, // nuber of parts depends of buffer size
              'currentBytes': progress.currentPart * bufferSize,
              'totalBytes': file.size
            })
          }
      } )
    })
  }

  const uploadUriCache = {} // fileHash -> uri

  return {
    MD5Hash: md5Promise,
    Uploader: function ({signedURI, uploadURI, file}) {
      const states = {
        EMPTY: 0,
        PAUSE_CALLED: 5,
        PAUSED: 6,
        UPLOAD_FINISHED: 7
      }

      let xhrUploading = null
      let hash = null
      let state = null

      function setState(s) {
        state = s
      }

      const eventsHandler = {
        'disconnect': () => {},
        'uploadstarted': () => {},
        'uploadfinished': () => {console.log('finished')},
        'progress': (percent) => {console.log('% ' + percent)},
        'finished': () => {},
        'cancelupload': () => {},
        'uploaderror': () => {},
        'uploadpaused': () => {}
      }
  
      function dispatch(event) {
        eventsHandler[event](...Array.from(arguments).slice(1))
      }
  
      function checkUploadStatus () {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.onreadystatechange = function () {
            if(xhr.readyState === 4 && xhr.status === 308) {
              const rangeStatus = xhr.getResponseHeader('Range')
              if (rangeStatus === null) {
                resolve({'started': false, 'finished': false})
              } else {
                resolve({'started': true, 'finished': false, 'alreadySentBytes': parseInt(rangeStatus.split('-')[1])})
              }
            } else if (xhr.readyState === 4 && xhr.status === 200) {
              resolve({'started': true, 'finished': true})
            }
            else if (xhr.readyState === 4) {
              dispatch('disconnect')
              reject('checkUploadStatusError')
            }
          }
  
          xhr.open('PUT', uploadURI, true)
          xhr.setRequestHeader('Content-Range', `bytes */${file.size}`)
          xhr.send()
        })
      }
  
      function startUpload (startingByte) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()

          xhr.onreadystatechange = function () {
            if(xhr.readyState === 4 && xhr.status === 200) {
              xhrUploading = null
              hash = null
              state = states.UPLOAD_FINISHED
              resolve()
            } else if (xhr.readyState === 4) {
              xhrUploading = null
              hash = null
              switch(state) {
                case states.PAUSE_CALLED:
                  setState(states.PAUSED)
                  resolve()
                  break
                default:
                  reject()
              }
              reject()
            }
          }

          xhr.open('PUT', uploadURI, true)
  
          if (typeof startingByte === 'number' && startingByte > 0) {
            xhr.setRequestHeader('Content-Range', `bytes ${startingByte}-${file.size - 1}/${file.size}`)
          }
  
          if (xhr.upload) {
            xhr.upload.onprogress = function(e) {
              if (e.lengthComputable) {
                dispatch('progress', (startingByte + e.loaded) / file.size)
              }
            }
          }

          getArrayBuffer(file).then(ab => {
            xhr.send(ab.slice(startingByte))
            xhrUploading = xhr
          }).catch(e => {
            dispatch('uploaderror', e)
          })
        })
      }

      function getUploadURI() {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()

          xhr.onreadystatechange = function () {
            if(xhr.readyState === 4 && xhr.status === 201) {
              resolve(xhr.getResponseHeader('Location'))
            } else if (xhr.readyState === 4 && xhr.status === 400) {
              const parser = new DOMParser()
              xmlDoc = parser.parseFromString(xhr.responseText, 'text/xml')
              reject('GetUploadURI: ' + xmlDoc.getElementsByTagName('Error')[0].getElementsByTagName('Message')[0].childNodes[0].nodeValue)
            } else if (xhr.readyState === 4) {
              reject('GetUploadURI: unknow response')
            }
          }

          xhr.open('POST', signedURI, true)
          xhr.setRequestHeader('x-goog-resumable', 'start')
          xhr.setRequestHeader('Content-Type', file.type)
          xhr.send()
        })
      }

      this.on = (event, callback) => {
        if (typeof event !== 'string') {
          throw "event should be string"
        }

        if (typeof callback !== 'function') {
          throw new "callback should be a function"
        }

        if (Object.keys(eventsHandler).indexOf(event.toLowerCase())) {
          eventsHandler[event.toLowerCase()] = callback
        }
      }

      this.cancelUpload = () => {
        if (xhrUploading === null || hash === null) {
          throw 'Upload not started'
        }

        xhrUploading.abort()
        xhrUploading = null
        delete uploadUriCache[hash]
        hash = null
        dispatch('cancelupload')
      }

      this.pause = () => {
        if (xhrUploading === null || hash === null) {
          throw 'Upload not started'
        }

        setState(states.PAUSE_CALLED)
        xhrUploading.abort()
        xhrUploading = null
        dispatch('uploadpaused')
      }

      this.upload = () => {
        // console.log(typeof calculateMD5Hash)
        // md5Promise(file).then((res) => {
        //   console.log(res)
        // })
        ;(async () => {
          try {
            let initialByte = 0

            if (!hash) {
              const { hashResult } = await md5Promise(file)
              console.log(hashResult)
              hash = hashResult
            }

            if (!uploadURI) {
              if (uploadUriCache[hash]) {
                uploadURI = uploadUriCache[hash]
              } else {
                uploadURI = await getUploadURI()
                uploadUriCache[hash] = uploadURI
                console.log(uploadUriCache)
              }
            }

            if (uploadURI && typeof uploadURI === 'string') {
              const uploadStatus = await checkUploadStatus()
              if (uploadStatus.finished) {
                dispatch('uploadfinished')
                return
              }
              if (uploadStatus.started) {
                initialByte = uploadStatus.alreadySentBytes + 1
              }
            }
            dispatch('uploadstarted', {
              'hash': hash,
              'progress': initialByte / file.size,
              'uploadURI': uploadURI
            })
            await startUpload(initialByte)
            if (state === states.UPLOAD_FINISHED) {
              dispatch('uploadfinished')
              delete uploadUriCache[hash]
            }
          } catch (e) {
            console.error(e)
          }
        })()
      }
    }
  }
})
