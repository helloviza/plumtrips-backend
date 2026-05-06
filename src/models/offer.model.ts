import mongoose, { Schema, Document, Model } from "mongoose";

/** Enum */
export enum OfferType {
  Hotel = "Hotel",
  Flight = "Flight",
  Tour = "Tour",
  Transfer = "Transfer",
  Activity = "Activity",
  Package = "Package",
  Other = "Other",
}

/** Document Interface */
export interface OfferDocument extends Document {
  type: OfferType;
  title: string;
  subtitle: string;
  img: string;
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Schema */
const OfferSchema: Schema<OfferDocument> = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(OfferType),
      required: true,
    },
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    img: { type: String, required: true },
    active: { type: Boolean, default: true },
        createdBy: {
      type: Schema.Types.ObjectId,
      ref: "MarketingAdmin",
      required: false,
    },
  },
  {
    timestamps: true, // handles createdAt & updatedAt
  }
);

/** Model */
export const OfferModel: Model<OfferDocument> =
  mongoose.models.Offer ||
  mongoose.model<OfferDocument>("Offer", OfferSchema);

/** Payload Types */
export type CreateOfferPayload = {
  type: OfferType;
  title: string;
  subtitle: string;
  img: string;
  active: boolean;
};

export type UpdateOfferPayload = Partial<CreateOfferPayload> & {
  id: string;
};

/** Response Types */
export type OfferListResponse = {
  data: OfferDocument[];
  total: number;
};

export type OfferSingleResponse = {
  data: OfferDocument;
};