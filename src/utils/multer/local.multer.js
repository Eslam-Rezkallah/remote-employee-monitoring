import multer from "multer";
import path from "node:path";
import fs from "node:fs";
export const fileValidations = {
  image: ["image/jpeg", "image/png", "image/gif"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};
export const uploadFileDisk = (customPath = "general", fileValidation = []) => {
  const basePath = `uploads/${customPath}`;
  const fullPath = path.resolve(`./src/${basePath}`);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      const finalFileName =
        Date.now() + "-" + Math.round(Math.random() * 1e9) + file.originalname;
      file.finalPath = basePath + "/" + finalFileName;
      cb(null, finalFileName);
    },
  });
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
  return multer({ det: "tempPath", fileFilter, storage });
};
