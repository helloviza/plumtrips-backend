export type BlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'p'
  | 'quote'
  | 'image'
  | 'cover'
  | 'gallery'
  | 'numlist'
  | 'hotel'
  | 'map'
  | 'video'
  | 'newsletter';

export interface BlockLibraryItem {
  type: BlockType;
  label: string;
  desc: string;
  icon: string;
}

export interface ListItem {
  n: number;
  title: string;
  loc: string;
  body: string;
  img?: string;
}

export interface MapPin {
  x: number;
  y: number;
  label: string;
}

export interface PostBlock {
  id: string;
  type: BlockType;
  text?: string;
  cite?: string;
  caption?: string;
  src?: string;
  images?: string[];
  items?: ListItem[];
  kicker?: string;
  name?: string;
  loc?: string;
  desc?: string;
  price?: string;
  nights?: string;
  img?: string;
  pins?: MapPin[];
  title?: string;
  body?: string;
  url?: string;
  [key: string]: any;
}

export interface PostCover {
  src: string;
  caption: string;
}

export interface PostAuthor {
  name: string;
  role: string;
  initials: string;
  avatar: string;
}

export interface RelatedPost {
  cat: string;
  title: string;
  excerpt: string;
  thumb: string;
}

export interface PostSeo {
  title: string;
  description: string;
  ogImage: string;
}

export interface Post {
  id?: string;
  title: string;
  subtitle: string;
  slug: string;
  excerpt: string;
  cover?: PostCover;
  author: PostAuthor;
  categories: string[];
  tags: string[];
  readingTime: number;
  publishDate: string;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  featured: boolean;
  seo: PostSeo;
  blocks: PostBlock[];
  related: RelatedPost[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BlogFilters {
  category?: string;
  tag?: string;
  author?: string;
  status?: 'draft' | 'scheduled' | 'published' | 'archived';
  featured?: boolean;
  search?: string;
}

export interface BlogListResponse {
  posts: Post[];
  total: number;
  page: number;
  limit: number;
  filters?: BlogFilters;
}

export interface BlogCreateRequest {
  title: string;
  subtitle?: string;
  content?: string;
  categories?: string[];
  tags?: string[];
  featured?: boolean;
  publishDate?: string;
  status?: 'draft' | 'scheduled' | 'published';
}

export interface BlogUpdateRequest extends Partial<BlogCreateRequest> {
  id: string;
}

// Mongoose Schemas and Models
import mongoose, { Schema, Document } from 'mongoose';

const ListItemSchema = new Schema({
  n: { type: Number, required: true },
  title: { type: String, required: true },
  loc: { type: String, required: true },
  body: { type: String, required: true },
  img: { type: String },
}, { _id: false });

const MapPinSchema = new Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  label: { type: String, required: true },
}, { _id: false });

const PostBlockSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ['h1', 'h2', 'h3', 'p', 'quote', 'image', 'cover', 'gallery', 'numlist', 'hotel', 'map', 'video', 'newsletter'], required: true },
  text: { type: String },
  cite: { type: String },
  caption: { type: String },
  src: { type: String },
  images: [{ type: String }],
  items: [ListItemSchema],
  kicker: { type: String },
  name: { type: String },
  loc: { type: String },
  desc: { type: String },
  price: { type: String },
  nights: { type: String },
  img: { type: String },
  pins: [MapPinSchema],
  title: { type: String },
  body: { type: String },
  url: { type: String },
}, { _id: false });

const PostCoverSchema = new Schema({
  src: { type: String, required: true },
  caption: { type: String, required: true },
}, { _id: false });

const PostAuthorSchema = new Schema({
  name: { type: String, required: true },
  role: { type: String, required: true },
  initials: { type: String, required: true },
  avatar: { type: String, required: true },
}, { _id: false });

const RelatedPostSchema = new Schema({
  cat: { type: String, required: true },
  title: { type: String, required: true },
  excerpt: { type: String, required: true },
  thumb: { type: String, required: true },
}, { _id: false });

const PostSeoSchema = new Schema({
  title: { type: String },
  description: { type: String},
  ogImage: { type: String },
}, { _id: false });

const PostSchema = new Schema({
  title: { type: String, required: true },
  subtitle: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  excerpt: { type: String, required: true },
  cover: PostCoverSchema,
  author: PostAuthorSchema,
  categories: [{ type: String }],
  tags: [{ type: String }],
  readingTime: { type: Number, required: true },
  publishDate: { type: String, required: true },
  status: { type: String, enum: ['draft', 'scheduled', 'published', 'archived'], required: true },
  featured: { type: Boolean, required: true },
  seo: PostSeoSchema,
  blocks: [PostBlockSchema],
  related: [RelatedPostSchema],
}, {
  timestamps: true,
});

export const BlogModel = mongoose.model<Document & Post>('Blog', PostSchema);