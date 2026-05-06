import mongoose, { Schema, Document, Model } from "mongoose";

/** Enum */
export enum CruiseScope {
  International = "International",
  Domestic = "Domestic",
}

/** Document Interface (MongoDB) */
export interface CruiseDocument extends Document {
  title: string;
  subtitle: string;
  price: number;
  scope: CruiseScope;
  trending: boolean;
  active: boolean;
  image: string;
  href: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Schema */
const CruiseSchema: Schema<CruiseDocument> = new Schema(
  {
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    price: { type: Number, required: true },
    scope: {
      type: String,
      enum: Object.values(CruiseScope),
      required: true,
    },
    trending: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
    image: { type: String, required: true },
    href: { type: String, required: true },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "MarketingAdmin",
      required: false,
    },
  },
  {
    timestamps: true, // adds createdAt & updatedAt automatically
  }
);

/** Model */
export const CruiseModel: Model<CruiseDocument> =
  mongoose.models.Cruise ||
  mongoose.model<CruiseDocument>("Cruise", CruiseSchema);

/** Payload Types (unchanged but reused) */
export type CreateCruisePayload = {
  title: string;
  subtitle: string;
  price: number;
  scope: CruiseScope;
  trending: boolean;
  active: boolean;
  image: string;
  href: string;
};

export type UpdateCruisePayload = Partial<CreateCruisePayload> & {
  id: string;
};

/** Response Types */
export type CruiseListResponse = {
  data: CruiseDocument[];
  total: number;
};

export type CruiseSingleResponse = {
  data: CruiseDocument;
};