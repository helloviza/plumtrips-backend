import { Router } from "express";
import requireUser from "../mw/requireUser.js";
import User from "../models/user.model.js";
import Session from "../models/session.model.js";
const r = Router();
r.use(requireUser);
// quick sanity check (returns your userId/sessionId if logged in)
r.get("/whoami", (req, res) => {
    res.json({ ok: true, userId: req.userId, sessionId: req.sessionId });
});
const weights = {
    // Identity & contact (45)
    name: 8,
    verify_mobile: 12,
    verify_email: 12,
    dob: 5,
    gender: 3,
    avatar: 5,
    // Travel essentials (30)
    address: 6,
    passport: 10,
    emergency_contact: 6,
    prefs: 4,
    gst: 4,
    // Payment & security (15)
    payment: 6,
    "2fa": 6,
    backup_email: 3,
    // Experience (10)
    co_traveller: 4,
};
const targets = {
    verify_mobile: "action:openOtp",
    verify_email: "action:sendEmailVerification",
    passport: "/account/profile#passport",
    address: "/account/profile#address",
    emergency_contact: "/account/profile#emergency",
    "2fa": "/account/security#2fa",
    backup_email: "/account/security#backup-email",
    payment: "/account/payments#add-card",
    co_traveller: "/account/co-travellers#add",
    prefs: "/account/profile#preferences",
    gst: "/account/profile#mybiz",
};
const labels = {
    verify_mobile: "Verify your mobile",
    verify_email: "Verify your email",
    passport: "Add your passport",
    address: "Add your address",
    emergency_contact: "Add emergency contact",
    "2fa": "Enable 2FA",
    backup_email: "Add backup email",
    payment: "Add a payment method",
    co_traveller: "Add a co-traveller",
    prefs: "Set your travel preferences",
    gst: "Add business details (GST)",
};
const reasons = {
    verify_mobile: "Required for OTP at checkout.",
    verify_email: "Confirms your account and improves security.",
    passport: "Saves time during international bookings.",
    address: "Helps with billing and accurate suggestions.",
    emergency_contact: "For your safety during travel.",
    "2fa": "Adds an extra layer of protection.",
    backup_email: "A recovery option if you lose access.",
    payment: "Enables faster checkout.",
    co_traveller: "Streamlines booking for your group.",
    prefs: "Get smarter fare and seat matches.",
    gst: "Needed for business invoicing.",
};
const cta = {
    verify_mobile: "Send OTP",
    verify_email: "Send link",
    passport: "Add passport",
    address: "Add address",
    emergency_contact: "Add now",
    "2fa": "Enable 2FA",
    backup_email: "Add backup",
    payment: "Add card",
    co_traveller: "Add co-traveller",
    prefs: "Set preferences",
    gst: "Add GST",
};
function bandFor(score) {
    if (score >= 100)
        return "complete";
    if (score >= 75)
        return "almost";
    if (score >= 50)
        return "half";
    if (score >= 25)
        return "good";
    return "start";
}
function isSnoozed(key, user) {
    const list = user?.profileCompletion?.snoozed || [];
    const now = Date.now();
    return list.some((s) => s.key === key && new Date(s.expiresAt).getTime() > now);
}
function computeProfileCompletion(user) {
    // Accept both top-level and profile-nested fields
    const p = user?.profile || {};
    const firstName = p.firstName ?? user.firstName;
    const lastName = p.lastName ?? user.lastName;
    const emailVerified = user.emailVerified ?? p.emailVerified ?? false;
    const mobileVerified = user.mobileVerified ?? p.mobileVerified ?? false;
    const dob = p.dob ?? user.dob;
    const gender = p.gender ?? user.gender;
    const avatarUrl = p.avatarUrl ?? user.avatarUrl;
    const address = p.address ?? user.address ?? {};
    const passport = p.passport ?? user.passport ?? {};
    const emergency = p.emergencyContact ?? user.emergencyContact ?? {};
    const prefs = p.preferences ?? user.preferences ?? {};
    const hasMyBiz = user.hasMyBiz ?? p.hasMyBiz ?? false;
    const gst = p.gst ?? user.gst ?? {};
    const paymentMethods = user.paymentMethods ?? p.paymentMethods ?? [];
    const twoFactorEnabled = user?.twoFactor?.enabled ?? p?.twoFactor?.enabled ?? false;
    const backupEmail = user.backupEmail ?? p.backupEmail;
    const coTravellers = user.coTravellers ?? p.coTravellers ?? [];
    const items = [];
    // Identity & contact
    const hasName = !!(firstName && lastName);
    const hasDob = !!dob;
    const hasGender = !!gender;
    const hasAvatar = !!avatarUrl;
    items.push({ key: "name", label: "Name", weight: weights.name, completed: hasName }, {
        key: "verify_mobile",
        label: "Mobile verified",
        weight: weights.verify_mobile,
        completed: !!mobileVerified,
    }, {
        key: "verify_email",
        label: "Email verified",
        weight: weights.verify_email,
        completed: !!emailVerified,
    }, { key: "dob", label: "Date of birth", weight: weights.dob, completed: hasDob }, { key: "gender", label: "Gender", weight: weights.gender, completed: hasGender }, { key: "avatar", label: "Profile photo", weight: weights.avatar, completed: hasAvatar });
    // Travel essentials
    const hasAddress = !!(address.country && address.city && address.postalCode);
    const hasPassport = !!(passport.number && passport.expiry);
    const hasEmergency = !!(emergency.name && emergency.phone);
    const hasPrefs = !!(prefs.airlines?.length || prefs.meal || prefs.seat);
    const hasGst = !!(hasMyBiz && (gst.number || gst.companyName));
    items.push({ key: "address", label: "Primary address", weight: weights.address, completed: hasAddress }, { key: "passport", label: "Passport", weight: weights.passport, completed: hasPassport }, { key: "emergency_contact", label: "Emergency contact", weight: weights.emergency_contact, completed: hasEmergency }, { key: "prefs", label: "Travel preferences", weight: weights.prefs, completed: hasPrefs }, { key: "gst", label: "GST / Business details", weight: weights.gst, completed: hasGst });
    // Payment & security
    const hasPayment = Array.isArray(paymentMethods) && paymentMethods.length > 0;
    const has2fa = !!twoFactorEnabled;
    const hasBackup = !!backupEmail;
    items.push({ key: "payment", label: "Saved payment method", weight: weights.payment, completed: hasPayment }, { key: "2fa", label: "Two-factor authentication", weight: weights["2fa"], completed: has2fa }, { key: "backup_email", label: "Backup email", weight: weights.backup_email, completed: hasBackup });
    // Experience
    const hasCoTrav = Array.isArray(coTravellers) && coTravellers.length > 0;
    items.push({ key: "co_traveller", label: "Co-traveller", weight: weights.co_traveller, completed: hasCoTrav });
    // Compute score
    const total = items.reduce((acc, i) => acc + i.weight, 0);
    const achieved = items.reduce((acc, i) => acc + (i.completed ? i.weight : 0), 0);
    const score = Math.min(100, Math.round((achieved / total) * 100));
    const band = bandFor(score);
    // Next-step priority
    const priority = [
        "verify_mobile",
        "verify_email",
        "passport",
        "address",
        "emergency_contact",
        "2fa",
        "backup_email",
        "payment",
        "co_traveller",
        "prefs",
        "gst",
    ];
    const incomplete = {};
    for (const it of items) {
        if (priority.includes(it.key) && !it.completed) {
            incomplete[it.key] = it;
        }
    }
    let nextStep;
    for (const k of priority) {
        if (!incomplete[k])
            continue;
        if (isSnoozed(k, user))
            continue;
        nextStep = {
            key: k,
            label: labels[k],
            reason: reasons[k],
            ctaText: cta[k],
            target: targets[k],
        };
        break;
    }
    const snoozed = (user?.profileCompletion?.snoozed || []).map((s) => s.key);
    return {
        score,
        band,
        nextStep,
        breakdown: items,
        snoozed,
    };
}
/* =========================================================================
   Existing routes
   ========================================================================= */
// PROFILE
r.get("/profile", async (req, res) => {
    // prevent client/proxy caching (avoids 304 with stale body)
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    const user = await User.findById(req.userId).lean();
    res.status(200).json({ ok: true, profile: user?.profile || {} });
});
r.put("/profile", async (req, res) => {
    const profile = req.body?.profile || {};
    // Persist everything under profile (even if schema doesn’t declare nested keys)
    await User.updateOne({ _id: req.userId }, { $set: { profile } }, { strict: false });
    // Return the canonical, saved profile to the client
    const updated = await User.findById(req.userId, { profile: 1 }).lean();
    res.status(200).json({ ok: true, profile: updated?.profile || {} });
});
// CO-TRAVELLERS
r.get("/co-travellers", async (req, res) => {
    const user = await User.findById(req.userId, { coTravellers: 1 }).lean();
    res.json({ ok: true, items: user?.coTravellers || [] });
});
r.post("/co-travellers", async (req, res) => {
    const doc = req.body || {};
    const user = await User.findByIdAndUpdate(req.userId, { $push: { coTravellers: doc } }, { new: true, fields: { coTravellers: { $slice: -1 } } }).lean();
    const created = user?.coTravellers?.[user.coTravellers.length - 1];
    res.json({ ok: true, item: created });
});
r.put("/co-travellers/:id", async (req, res) => {
    const { id } = req.params;
    const update = req.body || {};
    await User.updateOne({ _id: req.userId, "coTravellers._id": id }, { $set: Object.fromEntries(Object.entries(update).map(([k, v]) => [`coTravellers.$.${k}`, v])) });
    res.json({ ok: true });
});
r.delete("/co-travellers/:id", async (req, res) => {
    const { id } = req.params;
    await User.updateOne({ _id: req.userId }, { $pull: { coTravellers: { _id: id } } });
    res.json({ ok: true });
});
// PASSWORD
r.put("/password", async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8)
        return res.status(400).json({ ok: false, message: "Invalid new password" });
    const user = await User.findById(req.userId);
    if (!user)
        return res.status(404).json({ ok: false });
    // compare
    const bcrypt = await import("bcryptjs");
    const ok = await bcrypt.compare(oldPassword || "", user.passwordHash || "");
    if (!ok)
        return res.status(400).json({ ok: false, message: "Old password incorrect" });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ ok: true });
});
// SESSIONS
r.get("/sessions", async (req, res) => {
    const sessions = await Session.find({ userId: req.userId, revokedAt: { $exists: false } })
        .sort({ createdAt: -1 })
        .lean();
    const currentSid = req.sessionId;
    const items = sessions.map((s) => ({ ...s, current: String(s._id) === currentSid }));
    res.json({ ok: true, items });
});
r.post("/sessions/:id/revoke", async (req, res) => {
    const { id } = req.params;
    await Session.updateOne({ _id: id, userId: req.userId }, { $set: { revokedAt: new Date() } });
    res.json({ ok: true });
});
/* =========================================================================
   NEW: Profile Completion endpoints
   ========================================================================= */
// GET /me/profile-completion
r.get("/profile-completion", async (req, res) => {
    try {
        // prevent stale client cache / conditional 304s
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
        const user = await User.findById(req.userId).lean();
        if (!user)
            return res.status(404).json({ ok: false, message: "User not found" });
        const payload = computeProfileCompletion(user);
        return res.status(200).json(payload);
    }
    catch (e) {
        console.error("profile-completion error:", e);
        return res.status(500).json({ ok: false, message: "Internal error" });
    }
});
// POST /me/profile-snooze  { key }
r.post("/profile-snooze", async (req, res) => {
    try {
        const { key } = req.body || {};
        if (!key)
            return res.status(400).json({ ok: false, message: "Missing key" });
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        // Ensure a single snooze entry per key, even if profileCompletion isn't in the schema.
        await User.updateOne({ _id: req.userId }, { $pull: { "profileCompletion.snoozed": { key } } }, { strict: false });
        await User.updateOne({ _id: req.userId }, { $push: { "profileCompletion.snoozed": { key, expiresAt } } }, { strict: false });
        return res.json({ ok: true, key, expiresAt });
    }
    catch (e) {
        console.error("profile-snooze error:", e);
        return res.status(500).json({ ok: false, message: "Internal error" });
    }
});
export default r;
