const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const { authenticateToken, requireClientOrTechnician } = require('../middleware/auth');
const router = express.Router();

// Configure DigitalOcean Spaces (AWS S3 compatible)
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT);
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.DO_SPACES_KEY,
  secretAccessKey: process.env.DO_SPACES_SECRET
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, documents, and audio files
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|txt|mp3|wav|m4a|ogg|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only allowed file types are permitted (images, documents, audio)'));
    }
  }
});

// Upload file to DigitalOcean Spaces
router.post('/file', authenticateToken, requireClientOrTechnician, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(req.file.originalname);
    const fileName = `${timestamp}-${randomString}${ext}`;
    
    // Determine file type for folder organization
    let folder = 'files';
    if (req.file.mimetype.startsWith('image/')) {
      folder = 'images';
    } else if (req.file.mimetype.startsWith('audio/')) {
      folder = 'audio';
    }

    const uploadParams = {
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: `chat-${folder}/${fileName}`,
      Body: req.file.buffer,
      ACL: 'public-read',
      ContentType: req.file.mimetype,
      CacheControl: 'max-age=31536000', // 1 year cache
      Metadata: {
        'original-name': req.file.originalname,
        'uploaded-by': req.user.internal_user_id,
        'upload-date': new Date().toISOString()
      }
    };

    const result = await s3.upload(uploadParams).promise();

    // Log upload for audit
    console.log(`📎 File uploaded: ${fileName} by ${req.user.username} (${req.file.size} bytes)`);

    res.json({
      success: true,
      fileUrl: result.Location,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    if (error.message.includes('file types')) {
      res.status(400).json({ error: error.message });
    } else if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    } else {
      res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
  }
});

// Upload multiple files
router.post('/files', authenticateToken, requireClientOrTechnician, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadPromises = req.files.map(async (file) => {
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const ext = path.extname(file.originalname);
      const fileName = `${timestamp}-${randomString}${ext}`;
      
      let folder = 'files';
      if (file.mimetype.startsWith('image/')) {
        folder = 'images';
      } else if (file.mimetype.startsWith('audio/')) {
        folder = 'audio';
      }

      const uploadParams = {
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: `chat-${folder}/${fileName}`,
        Body: file.buffer,
        ACL: 'public-read',
        ContentType: file.mimetype,
        CacheControl: 'max-age=31536000',
        Metadata: {
          'original-name': file.originalname,
          'uploaded-by': req.user.internal_user_id,
          'upload-date': new Date().toISOString()
        }
      };

      const result = await s3.upload(uploadParams).promise();

      return {
        fileUrl: result.Location,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    console.log(`📎 ${uploadedFiles.length} files uploaded by ${req.user.username}`);

    res.json({
      success: true,
      files: uploadedFiles,
      count: uploadedFiles.length,
      uploadedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// Delete file (for admin or file owner)
router.delete('/file', authenticateToken, async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: 'File URL is required' });
    }

    // Extract key from URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Remove leading slash

    // Check if user has permission (admin or check if they uploaded it)
    if (req.user.user_type !== 'admin') {
      // Additional permission check could be added here
      // For now, allow users to delete files they reference in messages
    }

    const deleteParams = {
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: key
    };

    await s3.deleteObject(deleteParams).promise();

    console.log(`🗑️ File deleted: ${key} by ${req.user.username}`);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get upload statistics (admin only)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // This would require tracking uploads in database for detailed stats
    // For now, return basic S3 bucket info
    const params = {
      Bucket: process.env.DO_SPACES_BUCKET,
      Prefix: 'chat-'
    };

    const objects = await s3.listObjectsV2(params).promise();
    
    const stats = {
      total_files: objects.Contents.length,
      total_size: objects.Contents.reduce((sum, obj) => sum + obj.Size, 0),
      file_types: {},
      folders: {}
    };

    objects.Contents.forEach(obj => {
      const folder = obj.Key.split('/')[0];
      const ext = path.extname(obj.Key).toLowerCase();
      
      stats.folders[folder] = (stats.folders[folder] || 0) + 1;
      stats.file_types[ext] = (stats.file_types[ext] || 0) + 1;
    });

    res.json({
      success: true,
      stats: stats
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get upload statistics' });
  }
});

module.exports = router;