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

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET;
const FOLDER = process.env.AWS_FOLDER || 'testing';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>S3 Upload Test</h1>
        <form action="/upload" method="POST" enctype="multipart/form-data">
          <input type="file" name="file" accept="image/*" required />
          <button type="submit">Upload</button>
        </form>
        <p><a href="/images">View uploaded images</a></p>
      </body>
    </html>
  `);
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');

    const key = `${FOLDER}/${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    res.send(`Uploaded successfully. <a href="/images">View images</a>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload failed: ' + err.message);
  }
});

app.get('/images', async (req, res) => {
  try {
    const { Contents = [] } = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${FOLDER}/` })
    );

    if (!Contents.length) {
      return res.send('<h1>No images found</h1><p><a href="/">Back</a></p>');
    }

    const images = await Promise.all(
      Contents.map(async (item) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: item.Key }),
          { expiresIn: 3600 }
        );
        return `<div style="margin:20px">
          <img src="${url}" alt="${item.Key}" style="max-width:400px" />
          <form action="/delete" method="POST">
            <input type="hidden" name="key" value="${item.Key}" />
            <button type="submit">Delete</button>
          </form>
        </div>`;
      })
    );

    res.send(
      `<h1>Uploaded images</h1><p><a href="/">Back to upload</a></p>` +
        images.join('')
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to list images: ' + err.message);
  }
});

app.post('/delete', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: req.body.key })
    );
    res.redirect('/images');
  } catch (err) {
    console.error(err);
    res.status(500).send('Delete failed: ' + err.message);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});