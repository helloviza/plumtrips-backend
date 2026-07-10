import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * CouponUsage records every time a user successfully redeems a coupon.
 * This is what allows us to enforce "one ID (user) should only be able
 * to use a given coupon a limited number of times (default: once)".
 */
export interface ICouponUsage extends Document {
  coupon: Types.ObjectId;
  couponCode: string;
  userId: string;
  bookingId: string | null;
  bookingAmount: number;
  discountApplied: number;
  finalAmount: number;
  category: string;
  usedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICouponUsageModel extends Model<ICouponUsage> {}

const CouponUsageSchema = new Schema<ICouponUsage, ICouponUsageModel>(
  {
    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
      index: true,
    },

    couponCode: {
      // Denormalized for fast querying/reporting without a populate
      type: String,
      required: true,
      uppercase: true,
    },

    userId: {
      // The unique ID of whoever is using the coupon (customer id, email, etc.)
      type: String,
      required: [true, 'userId is required to redeem a coupon'],
      trim: true,
      index: true,
    },

    bookingId: {
      // Optional reference to the flight/hotel/etc. booking this coupon was applied to
      type: String,
      default: null,
    },

    bookingAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    discountApplied: {
      type: Number,
      required: true,
      min: 0,
    },

    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    category: {
      type: String,
      required: true,
    },

    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Speeds up "how many times has this user used this coupon" checks
CouponUsageSchema.index({ coupon: 1, userId: 1 });

const CouponUsage: ICouponUsageModel =
  (mongoose.models.CouponUsage as ICouponUsageModel) ||
  mongoose.model<ICouponUsage, ICouponUsageModel>('CouponUsage', CouponUsageSchema);

export default CouponUsage;