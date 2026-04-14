import multer from "multer";

export const fileValidations = {
  image: ["image/jpeg", "image/png", "image/gif", "image/jpg", "image/webp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  video: ["video/mp4", "video/mpeg", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"],
};

// ✅ FIX: Increased to 10MB to match socket.io maxHttpBufferSize
// ✅ FIX: Added audio/ogg and audio/webm for browser voice recording
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const uploadCloudFile = (fileValidation = []) => {
  const storage = multer.diskStorage({});

  function fileFilter(req, file, cb) {
    if (fileValidation.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type. Allowed types: ${fileValidation.join(", ")}`,
        ),
        false,
      );
    }
  }

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });
};
