Cloud Storage resume signed
==========

Upload manager for google cloud storage signed urls.

The objective of this library its be the most flexible possible, so here its some basics of how resumable uploads works on GCS:

* By default you can upload a file to a signed URI using the PUT method
* If you want a resumable upload, you should POST to the signed URI with `x-goog-resumable: start` header and no body, the response will contain a `X-GUploader-UploadID` header
* ALL signed URIs can have a  optional query parameter `upload_id`, its here that you identify a "upload session" and if for some reason lost connection its possible continue from the same byte
* A upload session have max life of one week
* You SHOULD use `action: 'resumable'` instead of `write when generating the signed URI`

Thats the most basic info you need to use this library, the concept of signed URI and upload id, if you want to know more in details i recommend check the GCS docs.
 
For this library the difference from a signedURI to a uploadURI its only the `upload_id` query parameter that you have at the second. You can pass one or another according with you own purpose:

* If you want permit continue uploads of the same file even in another computer, save the uploadURI at a database and the file hash provided at `uploadstarted` event. Check latter with the built in `cloudStorageSignedResumer.MD5Hash(<file>) `function and ask your backend if current user tried to upload a file with the same hash before, to get the same UploadURI and pass as parameter.

* If you want to continue only at the same browser tab that started the upload give the signedURI only, a built in cache will check for uploads of the same file that have not finished yet.

Example:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/spark-md5/3.0.0/spark-md5.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/q.js/1.4.0/q.min.js"></script>
<script src="cs-resume-signed.js">
<script>
	document.getElementById('myfileinput').onchange = function(e) {
		let uploader = new cloudStorageSignedResumer.Uploader({
		    'file': this.files[0],
		    'signedURI': '$SIGNED_URI_FROM_BACKEND',
		    'uploadURI': '$UPLOAD_URI'
		})

	      uploader.on('progress', (progress) => {
	          console.log(progress)
	      })
	   
	      uploader.on('uploadstarted', (info) => {
	          console.log(info)
	      })
	     
	      uploader.upload() // starts the upload
	  
	      window.setTimeout(() => {
	          uploader.pause() // pause the upload after 4 seconds
	      }, 4000)
	    
	      window.setTimeout(() => {
	          uploader.upload() // resumes the upload after 10 seconds
	      }, 10000)
	  }
</script>
```