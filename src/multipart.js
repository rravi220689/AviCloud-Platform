const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const config = require('./config');

function parseMultipart(req, destDir) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reject(new Error('Invalid content type'));
    }

    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return reject(new Error('No multipart boundary found'));
    
    const boundary = match[1] || match[2];
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', err => reject(err));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        let start = 0;
        const uploadedFiles = [];

        while (start < buffer.length) {
          const boundaryIdx = buffer.indexOf(boundaryBuffer, start);
          if (boundaryIdx === -1) break;

          const nextBoundaryIdx = buffer.indexOf(boundaryBuffer, boundaryIdx + boundaryBuffer.length);
          const partEnd = nextBoundaryIdx !== -1 ? nextBoundaryIdx : buffer.indexOf(endBoundaryBuffer, boundaryIdx);
          
          if (partEnd === -1) break;

          const part = buffer.slice(boundaryIdx + boundaryBuffer.length, partEnd);
          const headerEndIdx = part.indexOf('\r\n\r\n');

          if (headerEndIdx !== -1) {
            const headersStr = part.slice(0, headerEndIdx).toString('utf8');
            const fileData = part.slice(headerEndIdx + 4, part.length - 2); // strip trailing CRLF

            const filenameMatch = headersStr.match(/filename="([^"]+)"/);
            if (filenameMatch && filenameMatch[1]) {
              const filename = path.basename(filenameMatch[1]);
              const filePath = path.join(destDir, filename);

              // Check storage quota
              const stats = storage.getStorageStats();
              if (stats.usedBytes + fileData.length > config.MAX_STORAGE_BYTES) {
                return reject(new Error('Storage quota exceeded (100 GB limit)'));
              }

              fs.writeFileSync(filePath, fileData);
              uploadedFiles.push(filename);
            }
          }

          start = partEnd;
        }

        resolve(uploadedFiles);
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  parseMultipart
};
