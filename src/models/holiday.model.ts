import mongoose, { Schema, Document, Model } from "mongoose";

/** Enum */
export enum HolidayScope {
  International = "International",
  Domestic = "Domestic",
}

/** Document Interface */
export interface HolidayDocument extends Document {
  title: string;
  subtitle: string;
  price: number;
  scope: HolidayScope;
  trending: boolean;
  active: boolean;
  image: string;
  href: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Schema */
const HolidaySchema: Schema<HolidayDocument> = new Schema(
  {
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    price: { type: Number, required: true },
    scope: {
      type: String,
      enum: Object.values(HolidayScope),
      required: true,
    },
    trending: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    image: { type: String, required: true },
    href: { type: String, required: true },
        createdBy: {
      type: Schema.Types.ObjectId,
      ref: "MarketingAdmin",
      required: false,
    },
  },
  {
    timestamps: true, // auto adds createdAt & updatedAt
  }
);

/** Model */
export const HolidayModel: Model<HolidayDocument> =
  mongoose.models.Holiday ||
  mongoose.model<HolidayDocument>("Holiday", HolidaySchema);

/** Payload Types */
export type CreateHolidayPayload = {
  title: string;
  subtitle: string;
  price: number;
  scope: HolidayScope;
  trending: boolean;
  active: boolean;
  image: string;
  href: string;
};

export type UpdateHolidayPayload = Partial<CreateHolidayPayload> & {
  id: string;
};

/** Response Types */
export type HolidayListResponse = {
  data: HolidayDocument[];
  total: number;
};

export type HolidaySingleResponse = {
  data: HolidayDocument;
};