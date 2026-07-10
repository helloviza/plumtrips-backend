import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export const CATEGORY_ENUM = ['FLIGHT', 'HOTEL', 'GENERAL'] as const;
export type CategoryType = (typeof CATEGORY_ENUM)[number];

export const DISCOUNT_TYPE_ENUM = ['PERCENTAGE', 'FLAT'] as const;
export type DiscountTypeType = (typeof DISCOUNT_TYPE_ENUM)[number];

export interface ICoupon extends Document {
  code: string;
  description: string;
  category: CategoryType;
  discountType: DiscountTypeType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minBookingAmount: number;
  startDate: Date;
  endDate: Date;
  totalCoupons: number;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;

  // virtuals
  readonly isExhausted: boolean;
  readonly remaining: number;
}

// Static methods can be declared here if/when added later
export interface ICouponModel extends Model<ICoupon> {}

const CouponSchema = new Schema<ICoupon, ICouponModel>(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [3, 'Coupon code must be at least 3 characters'],
      maxlength: [30, 'Coupon code must not exceed 30 characters'],
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    category: {
      type: String,
      required: [true, 'Coupon category is required'],
      enum: {
        values: CATEGORY_ENUM,
        message: '{VALUE} is not a supported coupon category',
      },
      default: 'GENERAL',
      index: true,
    },

    discountType: {
      type: String,
      required: true,
      enum: {
        values: DISCOUNT_TYPE_ENUM,
        message: '{VALUE} is not a supported discount type',
      },
      default: 'PERCENTAGE',
    },

    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [0, 'Discount value cannot be negative'],
      validate: {
        validator: function (this: ICoupon, value: number): boolean {
          // If discount type is percentage, cap it logically at 100
          if (this.discountType === 'PERCENTAGE') {
            return value > 0 && value <= 100;
          }
          return value > 0;
        },
        message:
          'Invalid discountValue for the given discountType (percentage must be 1-100, flat must be > 0)',
      },
    },

    maxDiscountAmount: {
      // Only relevant for PERCENTAGE type, caps the max discount in currency
      type: Number,
      default: null,
      min: [0, 'maxDiscountAmount cannot be negative'],
    },

    minBookingAmount: {
      // Minimum order/booking value required to apply this coupon
      type: Number,
      default: 0,
      min: [0, 'minBookingAmount cannot be negative'],
    },

    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },

    endDate: {
      type: Date,
      required: [true, 'End date is required'],
      validate: {
        validator: function (this: ICoupon, value: Date): boolean {
          // endDate must be strictly after startDate
          return Boolean(this.startDate) && value > this.startDate;
        },
        message: 'endDate must be after startDate',
      },
    },

    totalCoupons: {
      // Total number of times this coupon CODE can be redeemed across all users
      type: Number,
      required: [true, 'Total number of coupons is required'],
      min: [1, 'totalCoupons must be at least 1'],
    },

    usedCount: {
      // How many times this coupon has been successfully redeemed so far
      type: Number,
      default: 0,
      min: 0,
    },

    perUserLimit: {
      // "One ID should have access to one coupon" -> by default a single user
      // may redeem this specific coupon code only once. Kept configurable
      // in case business rules change later (e.g. allow 2 uses per user).
      type: Number,
      default: 1,
      min: [1, 'perUserLimit must be at least 1'],
    },

    isActive: {
      // Manual kill-switch, independent of dates/usage counts
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: String,
      default: 'system',
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
  }
);

// Compound index to speed up the most common lookup: active coupon by code
CouponSchema.index({ code: 1, isActive: 1 });

// Virtual: is this coupon numerically exhausted (all copies used up)?
CouponSchema.virtual('isExhausted').get(function (this: ICoupon) {
  return this.usedCount >= this.totalCoupons;
});

// Virtual: remaining coupons available
CouponSchema.virtual('remaining').get(function (this: ICoupon) {
  return Math.max(this.totalCoupons - this.usedCount, 0);
});

CouponSchema.set('toJSON', { virtuals: true });
CouponSchema.set('toObject', { virtuals: true });

const Coupon: ICouponModel =
  (mongoose.models.Coupon as ICouponModel) ||
  mongoose.model<ICoupon, ICouponModel>('Coupon', CouponSchema);

export default Coupon;