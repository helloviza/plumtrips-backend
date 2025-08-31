// apps/backend/src/models/session.model.ts
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const SessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    userAgent: { type: String },
    ip: { type: String },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: false }
);

export type SessionDoc = mongoose.InferSchemaType<typeof SessionSchema>;

// ✅ reuse in dev to avoid OverwriteModelError
const Session =
  (models.Session as mongoose.Model<SessionDoc>) ||
  model<SessionDoc>("Session", SessionSchema);

export default Session;
