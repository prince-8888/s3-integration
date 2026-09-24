require("dotenv").config();

const express = require("express");
const multer = require("multer");

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// S3 CONFIGURATION
// ============================================================

const s3 = new S3Client({
  region: "us-east-1",

  // On-prem S3 endpoint
  endpoint: process.env.S3_ENDPOINT,

  // Required for S3-compatible storage
  forcePathStyle: true,

  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET;
const FOLDER = process.env.AWS_FOLDER || "testing";

// ============================================================
// MULTER
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

app.use(express.urlencoded({ extended: true }));

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>

    <html>

    <head>
      <title>On-Prem S3 Upload</title>
    </head>

    <body>

      <h1>On-Prem S3 Image Upload</h1>

      <form
        action="upload"
        method="POST"
        enctype="multipart/form-data"
      >

        <input
          type="file"
          name="file"
          accept="image/*"
          required
        >

        <br><br>

        <button type="submit">
          Upload Image
        </button>

      </form>

      <br>

      <a href="images">
        View Uploaded Images
      </a>

    </body>

    </html>
  `);
});

// ============================================================
// UPLOAD
// ============================================================

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file selected");
    }

    const fileName = req.file.originalname.replace(/\s+/g, "-");

    const key = `${FOLDER}/${Date.now()}-${fileName}`;

    console.log("Uploading file:");
    console.log("Bucket:", BUCKET);
    console.log("Key:", key);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    console.log("Upload successful:", key);

    res.send(`
      <h2>Upload Successful</h2>

      <p>
        ${key}
      </p>

      <a href="images">
        View Images
      </a>

      <br><br>

      <a href="./">
        Upload Another Image
      </a>
    `);

  } catch (err) {
    console.error("Upload error:", err);

    res.status(500).send(
      "Upload failed: " + err.message
    );
  }
});

// ============================================================
// LIST IMAGES
// ============================================================

app.get("/images", async (req, res) => {
  try {

    const data = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${FOLDER}/`,
      })
    );

    const files = (data.Contents || []).filter((file) =>
      /\.(jpg|jpeg|png|gif|webp)$/i.test(file.Key)
    );

    if (files.length === 0) {
      return res.send(`
        <h2>No Images Found</h2>

        <a href="./">
          Back to Upload
        </a>
      `);
    }

    const images = files.map((file) => {

      // Put the S3 key into query parameter
      const imageUrl =
        `image?key=${encodeURIComponent(file.Key)}`;

      return `
        <div class="image-card">

          <h4>
            ${file.Key}
          </h4>

          <img
            src="${imageUrl}"
            alt="${file.Key}"
          >

          <br><br>

          <a
            href="${imageUrl}"
            target="_blank"
          >
            Open Full Image
          </a>

          <br><br>

          <form
            action="delete"
            method="POST"
          >

            <input
              type="hidden"
              name="key"
              value="${file.Key}"
            >

            <button type="submit">
              Delete
            </button>

          </form>

        </div>
      `;
    });

    res.send(`
      <!DOCTYPE html>

      <html>

      <head>

        <title>Uploaded Images</title>

        <style>

          body {
            font-family: Arial, sans-serif;
            margin: 30px;
            background: #f5f5f5;
          }

          .container {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
          }

          .image-card {
            width: 350px;
            background: white;
            padding: 15px;
            border: 1px solid #ccc;
            border-radius: 8px;
          }

          .image-card img {
            width: 100%;
            height: 300px;
            object-fit: contain;
            background: #eee;
            border: 1px solid #ddd;
          }

          .image-card h4 {
            word-break: break-all;
          }

          button {
            padding: 7px 15px;
            cursor: pointer;
          }

        </style>

      </head>

      <body>

        <h1>Uploaded Images</h1>

        <p>
          <a href="./">
            Upload More Images
          </a>
        </p>

        <hr>

        <div class="container">

          ${images.join("")}

        </div>

      </body>

      </html>
    `);

  } catch (err) {

    console.error("List images error:", err);

    res.status(500).send(
      "Failed to list images: " + err.message
    );
  }
});

// ============================================================
// SERVE IMAGE FROM ON-PREM S3
// ============================================================
//
// Browser:
//
// /image?key=testing%2Fphoto.jpg
//
// Node.js:
//
// GetObjectCommand -> S3
//
// S3:
//
// Returns image bytes
//
// Node.js:
//
// Sends image bytes -> Browser
//
// ============================================================

app.get("/image", async (req, res) => {

  try {

    const key = req.query.key;

    if (!key) {
      return res.status(400).send(
        "Missing image key"
      );
    }

    console.log("Fetching image from S3:");
    console.log("Bucket:", BUCKET);
    console.log("Key:", key);

    const data = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    // Set correct content type
    if (data.ContentType) {
      res.setHeader(
        "Content-Type",
        data.ContentType
      );
    }

    // Tell browser to display the image
    res.setHeader(
      "Content-Disposition",
      "inline"
    );

    // Send S3 stream directly to browser
    data.Body.pipe(res);

  } catch (err) {

    console.error("Get image error:", err);

    res.status(500).send(
      "Failed to load image: " + err.message
    );
  }
});

// ============================================================
// DELETE
// ============================================================

app.post("/delete", async (req, res) => {

  try {

    const key = req.body.key;

    if (!key) {
      return res.status(400).send(
        "Missing object key"
      );
    }

    console.log("Deleting:");
    console.log("Bucket:", BUCKET);
    console.log("Key:", key);

    await s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    console.log("Delete successful:", key);

    res.redirect("images");

  } catch (err) {

    console.error("Delete error:", err);

    res.status(500).send(
      "Delete failed: " + err.message
    );
  }
});

// ============================================================
// FAVICON
// ============================================================

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

  console.log("----------------------------------------");
  console.log("S3 Integration Server Started");
  console.log("----------------------------------------");

  console.log(`Port: ${PORT}`);
  console.log(`S3 Endpoint: ${process.env.S3_ENDPOINT}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Folder: ${FOLDER}`);

  console.log("----------------------------------------");
});
