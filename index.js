require('dotenv').config();

const express = require('express');
const multer = require('multer');

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();

const port = process.env.PORT || 3000;


// ============================================================
// S3 CONFIGURATION
// ============================================================

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',

  // NIC / S3-compatible endpoint
  endpoint: process.env.S3_ENDPOINT,

  // Required for many S3-compatible storage systems
  forcePathStyle: true,

  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET;
const FOLDER = process.env.AWS_FOLDER || 'testing';


// ============================================================
// MULTER CONFIGURATION
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});


// ============================================================
// HOME PAGE
// ============================================================

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>S3 Upload Test</title>
      </head>

      <body>
        <h1>S3 Upload Test</h1>

        <form
          action="/upload"
          method="POST"
          enctype="multipart/form-data"
        >
          <input
            type="file"
            name="file"
            accept="image/*"
            required
          />

          <button type="submit">
            Upload
          </button>
        </form>

        <br>

        <p>
          <a href="/images">
            View uploaded images
          </a>
        </p>
      </body>
    </html>
  `);
});


// ============================================================
// UPLOAD IMAGE
// ============================================================

app.post('/upload', upload.single('file'), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Remove spaces from filename
    const fileName = req.file.originalname.replace(/\s+/g, '-');

    // Example:
    // testing/1727182312345-photo.jpg
    const key = `${FOLDER}/${Date.now()}-${fileName}`;

    console.log('Uploading:', key);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    console.log('Upload successful:', key);

    res.send(`
      <html>
        <body>
          <h2>Uploaded successfully!</h2>

          <p>
            <strong>File:</strong> ${key}
          </p>

          <p>
            <a href="/images">
              View uploaded images
            </a>
          </p>

          <p>
            <a href="/">
              Upload another image
            </a>
          </p>
        </body>
      </html>
    `);

  } catch (err) {

    console.error('Upload error:', err);

    res.status(500).send(
      'Upload failed: ' + err.message
    );
  }
});


// ============================================================
// LIST & DISPLAY IMAGES
// ============================================================

app.get('/images', async (req, res) => {

  try {

    const { Contents = [] } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${FOLDER}/`,
      })
    );

    // Only display image files
    const imageContents = Contents.filter(item =>
      /\.(jpg|jpeg|png|gif|webp)$/i.test(item.Key)
    );

    if (!imageContents.length) {

      return res.send(`
        <html>
          <body>

            <h1>No images found</h1>

            <p>
              <a href="/">
                Back to upload
              </a>
            </p>

          </body>
        </html>
      `);
    }


    // Generate signed URLs
    const images = await Promise.all(

      imageContents.map(async (item) => {

        const url = await getSignedUrl(

          s3,

          new GetObjectCommand({
            Bucket: BUCKET,
            Key: item.Key,
          }),

          {
            expiresIn: 3600, // 1 hour
          }
        );


        return `
          <div
            style="
              margin: 20px;
              padding: 20px;
              border: 1px solid #ccc;
              display: inline-block;
            "
          >

            <p>
              <strong>${item.Key}</strong>
            </p>

            <img
              src="${url}"
              alt="${item.Key}"
              style="
                max-width: 400px;
                max-height: 400px;
              "
            >

            <br><br>

            <form
              action="/delete"
              method="POST"
            >

              <input
                type="hidden"
                name="key"
                value="${item.Key}"
              >

              <button type="submit">
                Delete
              </button>

            </form>

          </div>
        `;
      })
    );


    res.send(`
      <html>

        <head>
          <title>Uploaded Images</title>
        </head>

        <body>

          <h1>Uploaded Images</h1>

          <p>
            <a href="/">
              Back to upload
            </a>
          </p>

          <hr>

          ${images.join('')}

        </body>

      </html>
    `);

  } catch (err) {

    console.error('List images error:', err);

    res.status(500).send(
      'Failed to list images: ' + err.message
    );
  }
});


// ============================================================
// DELETE IMAGE
// ============================================================

app.post(
  '/delete',
  express.urlencoded({ extended: true }),
  async (req, res) => {

    try {

      const key = req.body.key;

      if (!key) {
        return res.status(400).send(
          'Missing object key'
        );
      }

      console.log('Deleting:', key);

      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: key,
        })
      );

      console.log('Delete successful:', key);

      res.redirect('/images');

    } catch (err) {

      console.error('Delete error:', err);

      res.status(500).send(
        'Delete failed: ' + err.message
      );
    }
  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(port, () => {

  console.log(
    `Server running at http://localhost:${port}`
  );

  console.log(
    `S3 endpoint: ${process.env.S3_ENDPOINT}`
  );

  console.log(
    `Bucket: ${BUCKET}`
  );

  console.log(
    `Folder: ${FOLDER}`
  );
});