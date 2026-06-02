// apps/backend/src/models/home-carousel.model.ts
import mongoose, { Schema, Document, Model } from "mongoose";

/** Document Interface (MongoDB) */
export interface HomeCarouselDocument extends Document {
  name: string;
  image: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Schema */
const HomeCarouselSchema: Schema<HomeCarouselDocument> = new Schema(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },

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
export const HomeCarouselModel: Model<HomeCarouselDocument> =
  mongoose.models.HomeCarousel ||
  mongoose.model<HomeCarouselDocument>("HomeCarousel", HomeCarouselSchema);

/** Payload Types */
export type CreateHomeCarouselPayload = {
  name: string;
  image: string;
};

export type UpdateHomeCarouselPayload = Partial<CreateHomeCarouselPayload> & {
  id: string;
};

/** Response Types */
export type HomeCarouselListResponse = {
  data: HomeCarouselDocument[];
  total: number;
};

export type HomeCarouselSingleResponse = {
  data: HomeCarouselDocument;
};