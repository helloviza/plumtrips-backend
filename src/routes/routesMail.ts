import { Router, Request, Response } from "express";


const router = Router();

import  {sendMail, verifyMailer } from "./mailer.js"

router.post("/flight-confirmation", async (req, res) => {
  const {  email, subject, html } = req.body ?? {};
  if ( !email || !html) {
    return res.status(400).json({ success: false, error: "bookingId, email, and html are required" });
  }
 
  const ok = await sendMail(email, subject || `Flight Booking Confirmed `, html);
  return res.status(ok ? 200 : 502).json({ success: ok });
});
 
/**
 * POST /api/v1/email/hotel-confirmation
 * Body: { bookingId, email, subject?, html }
 */
router.post("/hotel-confirmation", async (req, res) => {
  const {  email, subject, html } = req.body ?? {};
  if ( !email || !html) {
    return res.status(400).json({ success: false, error: "bookingId, email, and html are required" });
  }
 
  const ok = await sendMail(email, subject || `Hotel Booking Confirmed `, html);
  return res.status(ok ? 200 : 502).json({ success: ok });
});
 
/**
 * POST /api/v1/email/tax-invoice
 * Body: { bookingId, email, type: 'flight' | 'hotel', subject?, html }
 */
router.post("/tax-invoice", async (req, res) => {
  const { email, type, subject, html } = req.body ?? {};
  if (!email || !html || (type !== "flight" && type !== "hotel")) {
    return res
      .status(400)
      .json({ success: false, error: "email, html, and a valid type ('flight'|'hotel') are required" });
  }
 
  const ok = await sendMail(email, subject || `Tax Invoice `, html);
  return res.status(ok ? 200 : 502).json({ success: ok });
});



export default router;