import mongoose, { Document, Schema } from "mongoose";

export interface IMarketingAdmin extends Document {
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

const marketingAdminSchema = new Schema<IMarketingAdmin>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const MarketingAdmin = mongoose.model<IMarketingAdmin>(
  "MarketingAdmin",
  marketingAdminSchema
);