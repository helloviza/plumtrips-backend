import { Request, Response } from 'express';
import Coupon, { ICoupon, CategoryType, DiscountTypeType } from '../models/Coupon.js';
import CouponUsage from '../models/CouponUsage.js';
import asyncHandler from '../mw/asyncHandler.js';
import ApiError from '../utils/couponAPIError.js';
import ApiResponse from '../utils/couponAPIResponse.js';
import { evaluateCoupon, applyCoupon } from '../services/couponService.js';
import type { AuthenticatedRequest } from '../auth/jwt.js';

interface CreateCouponBody {
  code: string;
  description?: string;
  category: CategoryType;
  discountType: DiscountTypeType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  minBookingAmount?: number;
  startDate: string | Date;
  endDate: string | Date;
  totalCoupons: number;
  perUserLimit?: number;
  isActive?: boolean;
}

type UpdateCouponBody = Partial<CreateCouponBody>;

interface GetAllCouponsQuery {
  category?: CategoryType;
  isActive?: string;
  page?: string;
  limit?: string;
}

interface ValidateOrApplyBody {
  code: string;
  userId: string;
  category: string;
  bookingAmount: number;
  bookingId?: string | null;
}

const ALLOWED_UPDATE_FIELDS: (keyof UpdateCouponBody)[] = [
  'description',
  'category',
  'discountType',
  'discountValue',
  'maxDiscountAmount',
  'minBookingAmount',
  'startDate',
  'endDate',
  'totalCoupons',
  'perUserLimit',
  'isActive',
];

/**
 * @desc    Create a new coupon
 * @route   POST /api/coupons
 * @access  Admin (x-admin-key header)
 */
export const createCoupon = asyncHandler(async (req: Request<{}, {}, CreateCouponBody>, res: Response) => {
  const {
    code,
    description,
    category,
    discountType,
    discountValue,
    maxDiscountAmount,
    minBookingAmount,
    startDate,
    endDate,
    totalCoupons,
    perUserLimit,
    isActive,
  } = req.body;

  const coupon = await Coupon.create({
    code,
    description,
    category,
    discountType,
    discountValue,
    maxDiscountAmount,
    minBookingAmount,
    startDate,
    endDate,
    totalCoupons,
    perUserLimit,
    isActive,
  });

  return res.status(201).json(new ApiResponse(201, coupon, 'Coupon created successfully'));
});

/**
 * @desc    Get all coupons (supports filtering + pagination)
 * @route   GET /api/coupons?category=&isActive=&page=&limit=
 * @access  Admin
 */
export const getAllCoupons = asyncHandler(
  async (req: Request<{}, {}, {}, GetAllCouponsQuery>, res: Response) => {
    const { category, isActive, page = '1', limit = '20' } = req.query;
 
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
 
    const skip = (Number(page) - 1) * Number(limit);
 
    const [coupons, total] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Coupon.countDocuments(filter),
    ]);
 
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          coupons,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
        'Coupons fetched successfully'
      )
    );
  }
);
 
/**
 * @desc    Get single coupon by ID
 * @route   GET /api/coupons/:id
 * @access  Admin
 */
export const getCouponById = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) {
    throw new ApiError(404, 'Coupon not found');
  }
  return res.status(200).json(new ApiResponse(200, coupon, 'Coupon fetched successfully'));
});
 
/**
 * @desc    Get single coupon by CODE (public-ish, useful for frontend to show coupon details)
 * @route   GET /api/coupons/code/:code
 * @access  Public
 */
export const getCouponByCode = asyncHandler(async (req: Request<{ code: string }>, res: Response) => {
  const coupon = await Coupon.findOne({ code: req.params.code.trim().toUpperCase() });
  if (!coupon) {
    throw new ApiError(404, 'Coupon not found');
  }
  return res.status(200).json(new ApiResponse(200, coupon, 'Coupon fetched successfully'));
});
 
/**
 * @desc    Update a coupon
 * @route   PUT /api/coupons/:id
 * @access  Admin
 */
export const updateCoupon = asyncHandler(
  async (req: Request<{ id: string }, {}, UpdateCouponBody>, res: Response) => {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      throw new ApiError(404, 'Coupon not found');
    }
 
    ALLOWED_UPDATE_FIELDS.forEach((field) => {
      const value = req.body[field];
      if (value !== undefined) {
        (coupon as unknown as Record<string, unknown>)[field] = value;
      }
    });
 
    // Guard: totalCoupons cannot be reduced below what has already been used
    if (coupon.totalCoupons < coupon.usedCount) {
      throw new ApiError(400, `totalCoupons cannot be less than usedCount (${coupon.usedCount})`);
    }
 
    await coupon.save(); // triggers schema validators (e.g. endDate > startDate)
 
    return res.status(200).json(new ApiResponse(200, coupon, 'Coupon updated successfully'));
  }
);
 
/**
 * @desc    Delete a coupon
 * @route   DELETE /api/coupons/:id
 * @access  Admin
 */
export const deleteCoupon = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) {
    throw new ApiError(404, 'Coupon not found');
  }
  return res.status(200).json(new ApiResponse(200, null, 'Coupon deleted successfully'));
});
 
/**
 * @desc    Validate a coupon WITHOUT consuming it (dry run / "case validation")
 *          Used by frontend to show "Apply" button state, discount preview, etc.
 * @route   POST /api/coupons/validate
 * @access  Authenticated user (userId comes from the session, never the body)
 * @body    { code, category, bookingAmount }
 */
export const validateCoupon = asyncHandler(
  async (req: AuthenticatedRequest & Request<{}, {}, ValidateOrApplyBody>, res: Response) => {
    const { code, category, bookingAmount } = req.body;
    const userId = req.user!.id;
 
    const evaluation = await evaluateCoupon({ code, userId, category, bookingAmount });
 
    const statusCode = evaluation.eligible ? 200 : 200; // still 200, "eligible" flag conveys result
    return res.status(statusCode).json(
      new ApiResponse(
        statusCode,
        {
          eligible: evaluation.eligible,
          reasonCode: evaluation.reasonCode,
          discountAmount: evaluation.discountAmount,
          finalAmount: evaluation.finalAmount,
          coupon: evaluation.coupon,
        },
        evaluation.message ?? undefined
      )
    );
  }
);
 
/**
 * @desc    Validate AND redeem a coupon (actually consumes one usage)
 * @route   POST /api/coupons/apply
 * @access  Authenticated user (userId comes from the session, never the body).
 *          Called by the booking flow at final checkout confirmation.
 * @body    { code, category, bookingAmount, bookingId }
 */
export const applyCouponController = asyncHandler(
  async (req: AuthenticatedRequest & Request<{}, {}, ValidateOrApplyBody>, res: Response) => {
    const { code, category, bookingAmount, bookingId } = req.body;
    const userId = req.user!.id;
 
    const result = await applyCoupon({ code, userId, category, bookingAmount, bookingId });
 
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          discountAmount: result.discountAmount,
          finalAmount: result.finalAmount,
          coupon: result.coupon,
          usage: result.usage,
        },
        'Coupon applied successfully'
      )
    );
  }
);
 
/**
 * @desc    Get usage history for the logged-in user (across all coupons)
 * @route   GET /api/coupons/usage/me
 * @access  Authenticated user (their own history only — never accepts a
 *          client-supplied userId, since that would let anyone read
 *          anyone else's redemption history by guessing/enumerating IDs)
 */
export const getUserUsageHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const usages = await CouponUsage.find({ userId: req.user!.id })
    .populate('coupon', 'code category discountType discountValue')
    .sort({ usedAt: -1 });
 
  return res.status(200).json(new ApiResponse(200, usages, 'Usage history fetched successfully'));
});
 
/**
 * @desc    Get usage history for a given coupon (all users who used it)
 * @route   GET /api/coupons/:id/usages
 * @access  Admin
 */
export const getCouponUsageHistory = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const usages = await CouponUsage.find({ coupon: req.params.id }).sort({ usedAt: -1 });
  return res.status(200).json(new ApiResponse(200, usages, 'Coupon usage history fetched successfully'));
});
 
export default {
  createCoupon,
  getAllCoupons,
  getCouponById,
  getCouponByCode,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  applyCouponController,
  getUserUsageHistory,
  getCouponUsageHistory,
};