import mongoose, { Document, Schema } from "mongoose";

export interface IInquiry extends Document {
  name: string;
  email?: string;
  phone: string;
  destination?: string;
  departureCity?: string;
  budget?: string;
  month?: string;
  travelers?: number;
  formType: "hero" | "holiday" | "general";
  createdAt: Date;
  updatedAt: Date;
}

const InquirySchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, required: true },
    destination: { type: String, default: "" },
    departureCity: { type: String, default: "" },
    budget: { type: String, default: "" },
    month: { type: String, default: "" },
    travelers: { type: Number, default: 0 },
    formType: { 
      type: String, 
      required: true,
      enum: ["hero", "holiday", "general"],
      default: "general"
    },
  },
  { timestamps: true }
);

export const Inquiry = mongoose.model<IInquiry>("Inquiry", InquirySchema);
