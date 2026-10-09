import mongoose, { Schema, Document } from 'mongoose';

export interface BlogInteraction extends Document {
  userId: mongoose.Types.ObjectId;
  blogId: mongoose.Types.ObjectId;
  liked: boolean;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

const blogInteractionSchema = new Schema<BlogInteraction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    blogId: {
      type: Schema.Types.ObjectId,
      ref: 'Blog',
      required: true,
    },

    liked: {
      type: Boolean,
      default: false,
    },

    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
  },
  {
    timestamps: true,
  }
);

blogInteractionSchema.index(
  { userId: 1, blogId: 1 },
  { unique: true }
);

export default mongoose.model<BlogInteraction>(
  'BlogInteraction',
  blogInteractionSchema
);