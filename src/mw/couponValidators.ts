import { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, param, validationResult, ValidationChain } from 'express-validator';
import ApiError from '../utils/couponAPIError.js';
import { CATEGORY_ENUM, DISCOUNT_TYPE_ENUM } from '../models/Coupon.js';

/**
 * Runs after any express-validator chain to collect and throw
 * a single formatted ApiError if any field failed validation.
 */
const validateRequest: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => `${e.type === 'field' ? e.path : e.type}: ${e.msg}`);
    return next(new ApiError(400, 'Request validation failed', messages));
  }
  next();
};
 
const createCouponRules: (ValidationChain | RequestHandler)[] = [
  body('code').isString().trim().isLength({ min: 3, max: 30 }).withMessage('code must be 3-30 characters'),
  body('category')
    .isIn(CATEGORY_ENUM)
    .withMessage(`category must be one of: ${CATEGORY_ENUM.join(', ')}`),
  body('discountType')
    .isIn(DISCOUNT_TYPE_ENUM)
    .withMessage(`discountType must be one of: ${DISCOUNT_TYPE_ENUM.join(', ')}`),
  body('discountValue').isFloat({ gt: 0 }).withMessage('discountValue must be greater than 0'),
  body('startDate').isISO8601().toDate().withMessage('startDate must be a valid date'),
  body('endDate').isISO8601().toDate().withMessage('endDate must be a valid date'),
  body('totalCoupons').isInt({ min: 1 }).withMessage('totalCoupons must be an integer >= 1'),
  body('perUserLimit').optional().isInt({ min: 1 }).withMessage('perUserLimit must be an integer >= 1'),
  body('minBookingAmount').optional().isFloat({ min: 0 }).withMessage('minBookingAmount must be >= 0'),
  body('maxDiscountAmount').optional().isFloat({ min: 0 }).withMessage('maxDiscountAmount must be >= 0'),
  validateRequest,
];
 
const updateCouponRules: (ValidationChain | RequestHandler)[] = [
  param('id').isMongoId().withMessage('Invalid coupon id'),
  body('category').optional().isIn(CATEGORY_ENUM),
  body('discountType').optional().isIn(DISCOUNT_TYPE_ENUM),
  body('discountValue').optional().isFloat({ gt: 0 }),
  body('startDate').optional().isISO8601().toDate(),
  body('endDate').optional().isISO8601().toDate(),
  body('totalCoupons').optional().isInt({ min: 1 }),
  body('perUserLimit').optional().isInt({ min: 1 }),
  validateRequest,
];
 
const mongoIdParamRule: (ValidationChain | RequestHandler)[] = [
  param('id').isMongoId().withMessage('Invalid coupon id'),
  validateRequest,
];
 
const applyOrValidateCouponRules: (ValidationChain | RequestHandler)[] = [
  body('code').isString().trim().notEmpty().withMessage('code is required'),
  // userId is intentionally NOT validated here — it is derived from the
  // authenticated session (req.user.id) in the controller, never accepted
  // from the request body. See requireAuth middleware.
  body('category')
    .isIn(CATEGORY_ENUM)
    .withMessage(`category must be one of: ${CATEGORY_ENUM.join(', ')}`),
  body('bookingAmount').isFloat({ gt: 0 }).withMessage('bookingAmount must be greater than 0'),
  body('bookingId').optional().isString().trim(),
  validateRequest,
];
 
export {
  validateRequest,
  createCouponRules,
  updateCouponRules,
  mongoIdParamRule,
  applyOrValidateCouponRules,
};
 
export default {
  validateRequest,
  createCouponRules,
  updateCouponRules,
  mongoIdParamRule,
  applyOrValidateCouponRules,
};