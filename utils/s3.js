const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const mime = require("mime-types");
const { s3Client } = require("../config/aws.js"); // config/aws.js también debe usar module.exports

async function getURLS3(key, minutes, folder = "") {
  const bucketName = `cardinal.bucket`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key:    folder ? `${folder}/${key}` : key
  });

  try {
    const url = await getSignedUrl(s3Client, command, { expiresIn: minutes * 60 });
    return url;
  } catch (err) {
    console.error("Error generando URL firmada en getURLS3:", err);
    // Opcional: devolver null o un objeto de error en lugar de lanzar
    throw err;
  }
}

async function putObjectS3(body, key, folder = "") {
  const contentType = mime.lookup(key) || "application/octet-stream";
  const command = new PutObjectCommand({
    Bucket:"cardinal.bucket",
    Key:folder ? `${folder}/${key}` : key,
    Body: body,
    ContentType: contentType,
  });
  return await s3Client.send(command);
}

module.exports = { getURLS3, putObjectS3 };