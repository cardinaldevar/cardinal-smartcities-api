// utils/s3Uploader.js
const { 
    S3Client, 
    PutObjectCommand, 
    DeleteObjectCommand, 
    GetObjectCommand 
} = require("@aws-sdk/client-s3");
const sharp = require('sharp');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { nanoid } = require("nanoid");


const s3Client = new S3Client({
    region: process.env.AWS_REGION_2,
});

const uploadFileToS3 = async (file, bucketName, folderName = null, options = {}) => {
  const { resize = false, width = 1000, quality = 70 } = options;

  const uniqueFileName = `${nanoid()}-${file.originalname.replace(/\s/g, '_')}`;
  const fullKey = folderName ? `${folderName}/${uniqueFileName}` : uniqueFileName;

  let bufferToUpload = file.buffer;
  let finalMimeType = file.mimetype;

   if (resize && finalMimeType.startsWith('image/')) {
        try {
            console.log(`🎨 Redimensionando imagen con sharp: ${file.originalname}`);

            // El encadenamiento de métodos de sharp es muy eficiente
            bufferToUpload = await sharp(file.buffer)
                .resize({ 
                    width: width, 
                    fit: 'inside',          // Mantiene aspect ratio
                    withoutEnlargement: true // No agranda imágenes más chicas que 'width'
                })
                .jpeg({ 
                    quality: quality, 
                    progressive: true,    // JPEG progresivo para mejor carga en web
                    optimizeScans: true   // Optimiza las pasadas de compresión
                })
                .toBuffer();
            
            finalMimeType = 'image/jpeg'; // Actualizamos el MimeType ya que convertimos a JPEG

            console.log('✨ Imagen procesada con éxito con sharp.');
        } catch (sharpError) {
            console.error('❌ Error al procesar la imagen con sharp:', sharpError);
            bufferToUpload = file.buffer; // fallback
        }
    }

  const params = {
    Bucket: bucketName,
    Key: fullKey,
    Body: bufferToUpload,
    ContentType: finalMimeType,
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION_2}.amazonaws.com/${fullKey}`;

    return {
      url: fileUrl,
      key: fullKey,
      originalName: file.originalname,
      fileType: finalMimeType,
      fileSize: bufferToUpload.length,
    };
    
  } catch (error) {
    console.error('❌ Error al subir el archivo a S3:', error);
    throw new Error('No se pudo subir el archivo.');
  }
};


const getSignedUrlForFile = async (fileKey, bucketName, expiresIn = 3600) => {
    const params = {
        Bucket: bucketName, // <--- Parámetro
        Key: fileKey,
    };

    try {
        const command = new GetObjectCommand(params);
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
        console.log(`✅ URL firmada generada para el archivo: ${fileKey}`);
        return signedUrl;
    } catch (error) {
        console.error("❌ Error al generar la URL firmada:", error);
        throw new Error("No se pudo obtener la URL del archivo.");
    }
};

const deleteFileFromS3 = async (fileKey, bucketName) => {
    const params = {
        Bucket: bucketName, // <--- Parámetro
        Key: fileKey,
    };

    try {
        const command = new DeleteObjectCommand(params);
        const response = await s3Client.send(command);
        console.log(`✅ Archivo eliminado con éxito: ${fileKey}`);
        return response;
    } catch (error) {
        console.error("❌ Error al eliminar el archivo de S3:", error);
        throw new Error("No se pudo eliminar el archivo.");
    }
};

module.exports = { 
    uploadFileToS3,
    getSignedUrlForFile,
    deleteFileFromS3
};