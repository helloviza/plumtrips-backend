import mongoose, { type Document, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export interface AIPlannerSubmissionDocument extends Document {
  user?: Types.ObjectId | string;
  sessionId: string;
  guestName?: string;
  departureCity?: string;
  originCity?: string;
  originAirportCode?: string;
  destination?: string;
  destinationCity?: string;
  destinationCityCode?: string;
  destinationAirportCode?: string;
  departDate?: string;
  returnDate?: string;
  adults?: number;
  children?: number;
  budget?: number;
  budgetINR?: number;
  tripVibe?: string;
  phoneNumber?: string;
  contactPhone?: string;
  specialRequests?: string;
  formValues: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AIPlannerSubmissionSchema = new Schema<AIPlannerSubmissionDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: false },
    sessionId: { type: String, required: true, index: true },

    // Structured planner fields for easier querying and analytics.
    guestName: { type: String, trim: true, index: true },
    departureCity: { type: String, trim: true, index: true },
    originCity: { type: String, trim: true, index: true },
    originAirportCode: { type: String, trim: true, index: true },
    destination: { type: String, trim: true, index: true },
    destinationCity: { type: String, trim: true, index: true },
    destinationCityCode: { type: String, trim: true, index: true },
    destinationAirportCode: { type: String, trim: true, index: true },
    departDate: { type: String, trim: true },
    returnDate: { type: String, trim: true },
    adults: { type: Number },
    children: { type: Number },
    budget: { type: Number },
    budgetINR: { type: Number },
    tripVibe: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    contactPhone: { type: String, trim: true, index: true },
    specialRequests: { type: String, trim: true },

    // Keep raw form values so custom or future fields are preserved.
    formValues: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

AIPlannerSubmissionSchema.index({ createdAt: -1 });
AIPlannerSubmissionSchema.index({ originCity: 1, destinationCity: 1, departDate: 1 });

export const AIPlannerSubmission =
  (models.AIPlannerSubmission as mongoose.Model<AIPlannerSubmissionDocument>) ||
  model<AIPlannerSubmissionDocument>("AIPlannerSubmission", AIPlannerSubmissionSchema);
