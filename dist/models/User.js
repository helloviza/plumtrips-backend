// apps/backend/src/models/User.ts
import mongoose from "mongoose";
const { Schema, model, models, Types } = mongoose;
const PaymentMethodSchema = new Schema({
    brand: String,
    last4: String,
}, { _id: false });
const UserSchema = new Schema({
    firstName: String,
    lastName: String,
    email: String,
    emailVerified: { type: Boolean, default: false },
    mobile: String,
    mobileVerified: { type: Boolean, default: false },
    dob: Date,
    gender: { type: String },
    avatarUrl: String,
    address: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        country: String,
        postalCode: String,
    },
    passport: {
        number: String,
        expiry: Date,
    },
    emergencyContact: {
        name: String,
        phone: String,
    },
    preferences: {
        airlines: [String],
        meal: String,
        seat: String,
    },
    hasMyBiz: { type: Boolean, default: false },
    gst: {
        number: String,
        companyName: String,
    },
    paymentMethods: [PaymentMethodSchema],
    twoFactor: {
        enabled: { type: Boolean, default: false },
    },
    backupEmail: String,
    coTravellers: [
        {
            firstName: String,
            lastName: String,
            relation: String,
        },
    ],
    wishlistCount: { type: Number, default: 0 },
    profileCompletion: {
        snoozed: [
            {
                key: String,
                expiresAt: Date,
            },
        ],
    },
}, { timestamps: true });
// ✅ reuse model in dev to prevent OverwriteModelError
const User = models.User || model("User", UserSchema);
export default User;
