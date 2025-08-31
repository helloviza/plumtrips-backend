// apps/backend/src/models/user.model.ts
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;
export type InferSchemaType<T> = mongoose.InferSchemaType<T>;
export type Model<T> = mongoose.Model<T>;
export type HydratedDocument<T> = mongoose.HydratedDocument<T>;

/** ---------- Sub-schemas (embedded) ---------- */
const FrequentFlyerSchema = new Schema(
  {
    airline: { type: String, trim: true },
    number: { type: String, trim: true },
  },
  { _id: false }
);

const PassportSchema = new Schema(
  {
    number: { type: String, trim: true },
    expiry: { type: Date },
    issuingCountry: { type: String, trim: true },
  },
  { _id: false }
);

const PreferencesSchema = new Schema(
  {
    domesticTripProtection: { type: String, trim: true },        // e.g., None | Basic | Plus | Premium
    internationalTravelInsurance: { type: String, trim: true },  // e.g., None | Basic | Gold | Platinum
    mealPreference: { type: String, trim: true },
    trainBerthPreference: { type: String, trim: true },
  },
  { _id: false }
);

const ProfileSchema = new Schema(
  {
    firstName: { type: String, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    gender: { type: String, enum: ["male", "female", "other"], default: undefined },
    dob: { type: Date },
    nationality: { type: String, trim: true },
    maritalStatus: { type: String, enum: ["single", "married", "divorced", "widowed"], default: undefined },
    anniversary: { type: Date },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },

    passport: { type: PassportSchema },
    pan: { type: String, trim: true },

    preferences: { type: PreferencesSchema },
    frequentFlyers: { type: [FrequentFlyerSchema], default: [] },
  },
  { _id: false }
);

const CoTravellerSchema = new Schema(
  {
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    gender: { type: String, enum: ["male", "female", "other"], default: undefined },
    dob: { type: Date },
    nationality: { type: String, trim: true },
    relationship: { type: String, trim: true },

    mealPreference: { type: String, trim: true },
    trainBerthPreference: { type: String, trim: true },

    passport: { type: PassportSchema },

    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },

    frequentFlyer: { type: FrequentFlyerSchema },
  },
  { _id: true, timestamps: true }
);

/** ---------- User schema ---------- */
const UserSchema = new Schema(
  {
    email: {
      type: String,
      unique: true,
      index: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    fullName: { type: String, trim: true },
    phone: { type: String, index: true },

    emailVerifiedAt: { type: Date },
    phoneVerifiedAt: { type: Date },

    roles: { type: [String], default: ["user"] },

    // New: rich profile + saved co-travellers
    profile: { type: ProfileSchema, default: {} },
    coTravellers: { type: [CoTravellerSchema], default: [] },
  },
  { timestamps: true }
);

/** ---------- Types ---------- */
export type IUser = mongoose.InferSchemaType<typeof UserSchema> & { _id: any };
export type UserDoc = mongoose.HydratedDocument<IUser>;

/** ---------- Model (reuse in dev) ---------- */
const User: mongoose.Model<IUser> =
  (models.User as mongoose.Model<IUser>) || model<IUser>("User", UserSchema);

export default User;
