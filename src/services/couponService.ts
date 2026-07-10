import Coupon, { ICoupon } from '../models/Coupon.js';
import CouponUsage, { ICouponUsage } from '../models/CouponUsage.js';
import ApiError from '../utils/couponAPIError.js';

export type ReasonCode =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_INACTIVE'
  | 'COUPON_NOT_YET_STARTED'
  | 'COUPON_EXPIRED'
  | 'COUPON_EXHAUSTED'
  | 'CATEGORY_MISMATCH'
  | 'MIN_BOOKING_AMOUNT_NOT_MET'
  | 'USER_LIMIT_REACHED'
  | 'OK';

export interface EvaluateCouponParams {
  code: string;
  userId: string;
  category: string;
  bookingAmount: number;
}

export interface ApplyCouponParams extends EvaluateCouponParams {
  bookingId?: string | null;
}

export interface EvaluationResult {
  eligible: boolean;
  reasonCode: ReasonCode | null;
  message: string | null;
  coupon: ICoupon | null;
  discountAmount: number;
  finalAmount: number;
}

export interface ApplyCouponResult {
  coupon: ICoupon;
  usage: ICouponUsage;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Runs every business-rule "case" that determines whether a coupon can be
 * used right now, by this user, for this category/amount. Returns a plain
 * object describing the outcome so both /validate and /apply can share it.
 *
 * CASES CHECKED (in order):
 *   1. Coupon code exists
 *   2. Coupon is active (isActive flag)
 *   3. Current date is within [startDate, endDate]
 *   4. Coupon has not been numerically exhausted (usedCount < totalCoupons)
 *   5. Requested category matches the coupon's category (unless coupon is GENERAL)
 *   6. Booking amount meets minBookingAmount
 *   7. This specific user (userId) has not exceeded perUserLimit uses
 *      -> this is the "one ID should have access to one coupon" rule
 */
export async function evaluateCoupon({
  code,
  userId,
  category,
  bookingAmount,
}: EvaluateCouponParams): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    eligible: false,
    reasonCode: null,
    message: null,
    coupon: null,
    discountAmount: 0,
    finalAmount: bookingAmount,
  };

  // CASE 1: Coupon must exist
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() });
  if (!coupon) {
    result.reasonCode = 'COUPON_NOT_FOUND';
    result.message = 'No coupon exists with this code';
    return result;
  }
  result.coupon = coupon;

  // CASE 2: Coupon must be manually active
  if (!coupon.isActive) {
    result.reasonCode = 'COUPON_INACTIVE';
    result.message = 'This coupon has been deactivated';
    return result;
  }

  // CASE 3: Must be within the valid date window
  const now = new Date();
  if (now < coupon.startDate) {
    result.reasonCode = 'COUPON_NOT_YET_STARTED';
    result.message = `This coupon becomes valid on ${coupon.startDate.toISOString()}`;
    return result;
  }
  if (now > coupon.endDate) {
    result.reasonCode = 'COUPON_EXPIRED';
    result.message = `This coupon expired on ${coupon.endDate.toISOString()}`;
    return result;
  }

  // CASE 4: Total redemption cap must not be exhausted
  if (coupon.usedCount >= coupon.totalCoupons) {
    result.reasonCode = 'COUPON_EXHAUSTED';
    result.message = 'This coupon has reached its total redemption limit';
    return result;
  }

  // CASE 5: Category must match (GENERAL coupons apply to any category)
  if (coupon.category !== 'GENERAL' && coupon.category !== category) {
    result.reasonCode = 'CATEGORY_MISMATCH';
    result.message = `This coupon is only valid for category ${coupon.category}, not ${category}`;
    return result;
  }

  // CASE 6: Minimum booking amount
  if (bookingAmount < coupon.minBookingAmount) {
    result.reasonCode = 'MIN_BOOKING_AMOUNT_NOT_MET';
    result.message = `Minimum booking amount for this coupon is ${coupon.minBookingAmount}`;
    return result;
  }

  // CASE 7: Per-user usage limit ("one ID should have access to one coupon")
  const priorUsageCount = await CouponUsage.countDocuments({
    coupon: coupon._id,
    userId: String(userId).trim(),
  });
  if (priorUsageCount >= coupon.perUserLimit) {
    result.reasonCode = 'USER_LIMIT_REACHED';
    result.message =
      coupon.perUserLimit === 1
        ? 'You have already used this coupon'
        : `You have already used this coupon the maximum ${coupon.perUserLimit} time(s) allowed`;
    return result;
  }

  // All cases passed -> compute the discount
  let discountAmount = 0;
  if (coupon.discountType === 'PERCENTAGE') {
    discountAmount = (bookingAmount * coupon.discountValue) / 100;
    if (coupon.maxDiscountAmount != null) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
    }
  } else {
    // FLAT discount
    discountAmount = coupon.discountValue;
  }
  // Discount can never exceed the booking amount itself
  discountAmount = Math.min(discountAmount, bookingAmount);
  discountAmount = Math.round(discountAmount * 100) / 100;

  result.eligible = true;
  result.reasonCode = 'OK';
  result.message = 'Coupon is valid and can be applied';
  result.discountAmount = discountAmount;
  result.finalAmount = Math.round((bookingAmount - discountAmount) * 100) / 100;

  return result;
}

/**
 * Validates AND redeems a coupon atomically:
 *  - Re-checks eligibility
 *  - Atomically increments usedCount only if still under totalCoupons
 *    (prevents race conditions where two requests both pass the check
 *    at the same time and over-redeem the coupon)
 *  - Records a CouponUsage document
 */
export async function applyCoupon({
  code,
  userId,
  category,
  bookingAmount,
  bookingId,
}: ApplyCouponParams): Promise<ApplyCouponResult> {
  const evaluation = await evaluateCoupon({ code, userId, category, bookingAmount });

  if (!evaluation.eligible) {
    throw new ApiError(400, evaluation.message as string, [evaluation.reasonCode]);
  }

  const coupon = evaluation.coupon as ICoupon;

  // Atomic guard: only increments usedCount if it is still below totalCoupons
  // at the moment of the update. This protects against a race condition
  // where two simultaneous requests both passed the earlier check.
  const updatedCoupon = await Coupon.findOneAndUpdate(
    { _id: coupon._id, usedCount: { $lt: coupon.totalCoupons } },
    { $inc: { usedCount: 1 } },
    { new: true }
  );

  if (!updatedCoupon) {
    // Someone else redeemed the last copy between our check and this update
    throw new ApiError(409, 'This coupon was just exhausted, please try another coupon', [
      'COUPON_EXHAUSTED_RACE_CONDITION',
    ]);
  }

  // Double-check per-user limit again right before writing (race-condition guard
  // for concurrent requests from the same user, e.g. double-clicking "Apply").
  const priorUsageCount = await CouponUsage.countDocuments({
    coupon: coupon._id,
    userId: String(userId).trim(),
  });
  if (priorUsageCount >= coupon.perUserLimit) {
    // Roll back the increment since this particular user cannot use it
    await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: -1 } });
    throw new ApiError(400, 'You have already used this coupon', ['USER_LIMIT_REACHED']);
  }

  const usage = await CouponUsage.create({
    coupon: coupon._id,
    couponCode: coupon.code,
    userId: String(userId).trim(),
    bookingId: bookingId || null,
    bookingAmount,
    discountApplied: evaluation.discountAmount,
    finalAmount: evaluation.finalAmount,
    category,
  });

  return {
    coupon: updatedCoupon,
    usage,
    discountAmount: evaluation.discountAmount,
    finalAmount: evaluation.finalAmount,
  };
}

export default { evaluateCoupon, applyCoupon };