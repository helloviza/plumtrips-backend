// apps/backend/src/models/ssoTicket.model.ts
import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const ssoTicketSchema = new Schema(
  {
    jti: { type: String, required: true, unique: true, index: true },
    aud: { type: String, required: true, index: true },            // e.g. "helloviza"
    userId: { type: Types.ObjectId, required: true, index: true },
    expAt: { type: Date, required: true, index: true },
    usedAt: { type: Date },                                        // single-use guard
  },
  { timestamps: true }
);

// ✅ reuse existing model if hot-reload
const SsoTicket =
  (mongoose.models.SsoTicket as mongoose.Model<any>) ||
  model("SsoTicket", ssoTicketSchema);

export default SsoTicket;
