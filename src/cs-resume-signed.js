import xmlhttp from 'xmlhttprequest'
import SparkMD5 from 'spark-md5'
import Q from 'q'
import FileReader from 'nodefilereader'
import Blob from 'node-blob'
import xmldom from 'xmldom'

const XMLHttpRequest = xmlhttp.XMLHttpRequest
const DOMParser = xmldom.DOMParser

var fileSlicer = typeof File !== 'undefined' ? (File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice) : {call (file, start, end) {
  let blob = Blob.prototype.slice.call(file, start, end)
  blob.name = file.name
  blob.size = end - start
  blob.type = file.type
  return blob
}}

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
  var fileReader = new FileReader();
  var def = Q.defer();

  var hashAlgorithm = new SparkMD5();
  var totalParts = Math.ceil(file.size / bufferSize);
  var currentPart = 0;
  var startTime = new Date().getTime();

  fileReader.onload = function(e) {
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

export const MD5Hash = md5Promise

export const  Uploader = function ({signedURI, uploadURI, file}) {
  const states = {
    EMPTY: 0,
    UPLOAD_STARTED: 1,
    SET_DISCONNECT_CALLED: 2,
    DISCONNECTED: 3,
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
    'uploadfinished': () => {},
    'progress': () => {},
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
          xhrUploading = null
          dispatch('disconnect')
          reject('checkUploadStatusError')
        }
      }

      xhr.open('PUT', uploadURI, true);
      xhr.setRequestHeader('Content-Range', `bytes */${file.size}`)
      xhr.send()
    })
  }

  function startUpload (startingByte) {
    return new Promise(async (resolve, reject) => {
      try {
        const chunkSizeInMB = 10

        let chunkSizeInBytes = chunkSizeInMB * 1024 * 1024
        chunkSizeInBytes = chunkSizeInBytes - (chunkSizeInBytes % 256 * 1024) // gcs only accepts multiples of 256kb
        let bytesToSend = file.size - startingByte
        let numberOfParts = Math.ceil(bytesToSend / chunkSizeInBytes)

        let currentChunk = null

        let nextChunk = fileSlicer.call(file, startingByte, Math.min(file.size, startingByte + chunkSizeInBytes))

        state = states.UPLOAD_STARTED
        dispatch('uploadstarted', {
          'hash': hash,
          'progress': startingByte / file.size,
          'uploadURI': uploadURI
        })

        for (let i = 0; i < numberOfParts; i++) {
          currentChunk = nextChunk
          if (state === states.PAUSED) {
            resolve()
            break
          }

          let startChunk = startingByte + (i * chunkSizeInBytes)
          await Promise.all([
            _startUpload(startChunk, currentChunk),
            new Promise((resolve) => {
              if (i + 1  === numberOfParts) { // last part
                resolve()
              } else {
                let nextStartChunk = startingByte + ((i + 1) * chunkSizeInBytes)
                let nextEndChunk = Math.min(file.size, nextStartChunk + chunkSizeInBytes)
                nextChunk = fileSlicer.call(file, nextStartChunk, Math.min(file.size, nextEndChunk))
                resolve()
              }
            })
          ])
        }
        if (state === states.UPLOAD_STARTED) {
          hash = null
          state = states.UPLOAD_FINISHED
        }
        resolve()
      } catch(e) {
        reject(e)
      }
    })
  }

  function _startUpload (startingByte, chunk) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.onreadystatechange = function () {
        if(xhr.readyState === 4 && xhr.status === 200) {
          xhrUploading = null
          resolve()
        } else if (xhr.readyState === 4 && xhr.status === 308) {
          xhrUploading = null
          resolve()
        } else if (xhr.readyState === 4) {
          xhrUploading = null
          switch(state) {
            case states.PAUSE_CALLED:
              setState(states.PAUSED)
              resolve()
              break
            case states.SET_DISCONNECT_CALLED:
              setState(states.DISCONNECTED)
              resolve()
              break;
            default:
              if (xhr.status === 0) {
                dispatch('disconnected')
                reject()
              } else {
                reject('UNKNOW_ERROR')
              }
          }
        }
      }

      xhr.open('PUT', uploadURI, true)

      // if (typeof startingByte === 'number' && startingByte > 0) {
        xhr.setRequestHeader('Content-Range', `bytes ${startingByte}-${startingByte + chunk.size - 1}/${file.size}`)
      // }

      if (xhr.upload) {
        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) {
            dispatch('progress', (startingByte + e.loaded) / file.size)
          }
        }
      }
      getArrayBuffer(chunk).then(ab => {
        xhr.send(ab)
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

  this.setDisconnected = () => {
    if (xhrUploading === null || hash === null) {
      return
    }

    setState(states.SET_DISCONNECT_CALLED)
    xhrUploading.abort()
    xhrUploading = null
    dispatch('disconnected')
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
          hash = hashResult
        }

        if (!uploadURI) {
          if (uploadUriCache[hash]) {
            uploadURI = uploadUriCache[hash]
          } else {
            uploadURI = await getUploadURI()
            uploadUriCache[hash] = uploadURI
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