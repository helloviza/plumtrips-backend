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
    wishlist: 3,
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
    const list = user.profileCompletion?.snoozed || [];
    const now = Date.now();
    return list.some((s) => s.key === key && new Date(s.expiresAt).getTime() > now);
}
export function computeProfileCompletion(user) {
    const items = [];
    // Identity & contact
    const hasName = !!(user.firstName && user.lastName);
    const hasDob = !!user.dob;
    const hasGender = !!user.gender;
    const hasAvatar = !!user.avatarUrl;
    items.push({ key: "name", label: "Name", weight: weights.name, completed: hasName }, { key: "verify_mobile", label: "Mobile verified", weight: weights.verify_mobile, completed: !!user.mobileVerified }, { key: "verify_email", label: "Email verified", weight: weights.verify_email, completed: !!user.emailVerified }, { key: "dob", label: "Date of birth", weight: weights.dob, completed: hasDob }, { key: "gender", label: "Gender", weight: weights.gender, completed: hasGender }, { key: "avatar", label: "Profile photo", weight: weights.avatar, completed: hasAvatar });
    // Travel essentials
    const addr = user.address || {};
    const hasAddress = !!(addr.country && addr.city && addr.postalCode);
    const pass = user.passport || {};
    const hasPassport = !!(pass.number && pass.expiry);
    const emg = user.emergencyContact || {};
    const hasEmergency = !!(emg.name && emg.phone);
    const prefs = user.preferences || {};
    const hasPrefs = !!(prefs.airlines?.length || prefs.meal || prefs.seat);
    const hasGst = !!(user.hasMyBiz && (user.gst?.number || user.gst?.companyName));
    items.push({ key: "address", label: "Primary address", weight: weights.address, completed: hasAddress }, { key: "passport", label: "Passport", weight: weights.passport, completed: hasPassport }, { key: "emergency_contact", label: "Emergency contact", weight: weights.emergency_contact, completed: hasEmergency }, { key: "prefs", label: "Travel preferences", weight: weights.prefs, completed: hasPrefs }, { key: "gst", label: "GST / Business details", weight: weights.gst, completed: hasGst });
    // Payment & security
    const hasPayment = !!(user.paymentMethods && user.paymentMethods.length > 0);
    const has2fa = !!user.twoFactor?.enabled;
    const hasBackup = !!user.backupEmail;
    items.push({ key: "payment", label: "Saved payment method", weight: weights.payment, completed: hasPayment }, { key: "2fa", label: "Two-factor authentication", weight: weights["2fa"], completed: has2fa }, { key: "backup_email", label: "Backup email", weight: weights.backup_email, completed: hasBackup });
    // Experience
    const hasCoTrav = !!(user.coTravellers && user.coTravellers.length > 0);
    items.push({ key: "co_traveller", label: "Co-traveller", weight: weights.co_traveller, completed: hasCoTrav });
    // Compute score
    const total = items.reduce((acc, i) => acc + i.weight, 0);
    const achieved = items.reduce((acc, i) => acc + (i.completed ? i.weight : 0), 0);
    const score = Math.min(100, Math.round((achieved / total) * 100));
    const band = bandFor(score);
    // Next step priority
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
    let nextStep;
    for (const k of priority) {
        const incomplete = items.find(it => it.key === k && !it.completed);
        if (!incomplete)
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
    const snoozed = (user.profileCompletion?.snoozed || []).map((s) => s.key);
    return {
        score,
        band,
        nextStep,
        breakdown: items,
        snoozed,
    };
}
