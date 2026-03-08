import { Router } from "express";
import { authentication } from "../../../middleware/auth.middleware.js";
import {
  uploadCloudFile,
  fileValidations,
} from "../../../utils/multer/cloud.multer.js";
import { cloud } from "../../../utils/multer/cloudinary.js";
import fileModel from "../../../DB/model/file.model.js";
import asyncHandler from "../../../utils/response/asyncHandler.js";

const router = Router();

/**
 * POST /api/chat/upload
 * Upload file attachment for chat (image, doc, video, audio)
 * Returns file record that can be sent with socket message:send as attachmentIds
 */
router.post(
  "/upload",
  authentication,
  uploadCloudFile([
    ...fileValidations.image,
    ...fileValidations.document,
    ...fileValidations.video,
    ...fileValidations.audio,
  ]).single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload to cloudinary
    const folder = `chat/${req.user._id}`;
    const result = await cloud.uploader.upload(req.file.path, {
      folder,
      resource_type: "auto",
    });

    // Save file record
    const file = await fileModel.create({
      originalName: req.file.originalname,
      url: result.secure_url,
      key: result.public_id,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
      relatedModel: "Message",
    });

    return res.status(201).json({
      message: "File uploaded successfully",
      file: {
        _id: file._id,
        originalName: file.originalName,
        url: file.url,
        size: file.size,
        mimeType: file.mimeType,
      },
    });
  }),
);

/**
 * POST /api/chat/upload/voice
 * Upload voice message (audio blob)
 */
router.post(
  "/upload/voice",
  authentication,
  uploadCloudFile([...fileValidations.audio, "audio/webm", "audio/ogg"]).single(
    "voice",
  ),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No voice file uploaded" });
    }

    const result = await cloud.uploader.upload(req.file.path, {
      folder: `chat/voice/${req.user._id}`,
      resource_type: "video", // Cloudinary uses "video" for audio
    });

    const file = await fileModel.create({
      originalName: `voice_${Date.now()}.webm`,
      url: result.secure_url,
      key: result.public_id,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
      relatedModel: "Message",
    });

    return res.status(201).json({
      message: "Voice message uploaded successfully",
      file: {
        _id: file._id,
        originalName: file.originalName,
        url: file.url,
        size: file.size,
        mimeType: file.mimeType,
        isVoice: true,
      },
    });
  }),
);

export default router;
