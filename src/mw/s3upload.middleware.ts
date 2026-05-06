import { Request, Response, NextFunction } from "express";
import { uploadToS3 } from "../utils/s3.js";

export const uploadImageToS3 = (fieldName: string = "image") => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return next();

      const imageUrl = await uploadToS3(req.file);
      req.body[fieldName] = imageUrl;

      next();
    } catch (err) {
      next(err);
    }
  };
};