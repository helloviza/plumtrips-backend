import mongoose, { Schema, Document } from 'mongoose';

export interface IPost extends Document {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  status: 'draft' | 'published' | 'scheduled';
  publishAt?: Date;
  cover: { key: string; url: string };          // S3 key + CDN URL
  images: { name: string; key: string; url: string }[]; // section images
  bodyMdx: string;
  seo: { metaTitle: string; metaDesc: string };
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PostSchema = new Schema<IPost>({
  slug:       { type: String, required: true, unique: true },
  title:      { type: String, required: true },
  excerpt:    String,
  tags:       [String],
  status:     { type: String, enum: ['draft','published','scheduled'], default: 'draft' },
  publishAt:  Date,
  cover:      { key: String, url: String },
  images:     [{ name: String, key: String, url: String }],
  bodyMdx:    String,
  seo:        { metaTitle: String, metaDesc: String },
  featured:   { type: Boolean, default: false },
}, { timestamps: true });

export const Post = mongoose.model<IPost>('Post', PostSchema);