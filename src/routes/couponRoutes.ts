import express, { Router } from 'express';

import {
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
} from '../controller/couponController.js';

//import adminAuth from '../middleware/adminAuth';
import { authRequired } from '../auth/jwt.js';
import {
  createCouponRules,
  updateCouponRules,
  mongoIdParamRule,
  applyOrValidateCouponRules,
} from '../mw/couponValidators.js';

const router: Router = express.Router();

// ---------- Public / service-facing routes (Flights, Hotels, etc. call these) ----------

// ---------- User-facing routes (require a logged-in session) ----------
 
// Dry-run check: "can this user apply this coupon right now?"
// userId is derived from requireAuth's req.user, never from the request body.
router.post('/validate', authRequired, applyOrValidateCouponRules, validateCoupon);
 
// Actually redeem the coupon (call this at final booking confirmation step)
router.post('/apply', authRequired, applyOrValidateCouponRules, applyCouponController);
 
// The logged-in user's own redemption history (never anyone else's)
router.get('/usage/me', authRequired, getUserUsageHistory);
 

// A user's own redemption history
router.get('/usage/:userId', getUserUsageHistory);

// ---------- Admin routes (require x-admin-key header) ----------

router.post('/', createCouponRules, createCoupon);
router.get('/',  getAllCoupons);
router.get('/:id', mongoIdParamRule, getCouponById);
router.put('/:id', updateCouponRules, updateCoupon);
router.delete('/:id', mongoIdParamRule, deleteCoupon);
router.get('/:id/usages', mongoIdParamRule, getCouponUsageHistory);

export default router;