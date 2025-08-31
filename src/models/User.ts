// apps/backend/src/models/User.ts
import mongoose from "mongoose";

const { Schema, model, models, Types } = mongoose;

export interface IEmergencyContact {
  name?: string;
  phone?: string;
}

export interface IPassport {
  number?: string;
  expiry?: Date | string;
}

export interface IPreferences {
  airlines?: string[];
  meal?: string;
  seat?: string;
}

export interface IPaymentMethod {
  brand?: string;
  last4?: string;
}

export interface IProfileSnooze {
  key: string;            // e.g., 'verify_mobile'
  expiresAt: Date;
}

export interface IUser {
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  mobile?: string;
  mobileVerified?: boolean;
  dob?: Date | string;
  gender?: "male" | "female" | "other" | "prefer_not";
  avatarUrl?: string;

  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };

  passport?: IPassport;
  emergencyContact?: IEmergencyContact;

  preferences?: IPreferences;
  hasMyBiz?: boolean;
  gst?: { number?: string; companyName?: string };

  paymentMethods?: IPaymentMethod[];
  twoFactor?: { enabled?: boolean };
  backupEmail?: string;

  coTravellers?: Array<{
    _id?: typeof Types.ObjectId;
    firstName?: string;
    lastName?: string;
    relation?: string;
  }>;

  wishlistCount?: number;

  profileCompletion?: {
    snoozed?: IProfileSnooze[];
  };

  // other fields...
}

const PaymentMethodSchema = new Schema<IPaymentMethod>(
  {
    brand: String,
    last4: String,
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
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
  },
  { timestamps: true }
);

// ✅ reuse model in dev to prevent OverwriteModelError
const User = (models.User as mongoose.Model<IUser>) || model<IUser>("User", UserSchema);

export default User;
