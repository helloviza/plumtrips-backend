import { Post, BlogListResponse, BlogCreateRequest, BlogUpdateRequest, BlogFilters, BlogModel } from '../../models/blogs.model.js';
import { Router, Request, Response } from 'express';
import requireMarketingAdmin from '../../mw/requireMarketingAdmin.js';

// API Routes for Blog Management
export const BLOG_ROUTES = {
  // Get all blogs with optional filters
  GET_BLOGS: '/api/blogs',

  // Get a single blog by ID or slug
  GET_BLOG: (idOrSlug: string) => `/api/blogs/${idOrSlug}`,

  // Create a new blog post
  CREATE_BLOG: '/api/blogs',

  // Update an existing blog post
  UPDATE_BLOG: (id: string) => `/api/blogs/${id}`,

  // Delete a blog post
  DELETE_BLOG: (id: string) => `/api/blogs/${id}`,

  // Publish a blog post
  PUBLISH_BLOG: (id: string) => `/api/blogs/${id}/publish`,

  // Unpublish a blog post
  UNPUBLISH_BLOG: (id: string) => `/api/blogs/${id}/unpublish`,

  // Get blog categories
  GET_CATEGORIES: '/api/blogs/categories',

  // Get blog tags
  GET_TAGS: '/api/blogs/tags',

  // Get blog authors
  GET_AUTHORS: '/api/blogs/authors',

  // Upload blog image
  UPLOAD_IMAGE: '/api/blogs/upload-image',

  // Get blog statistics
  GET_STATS: '/api/blogs/stats',
} as const;

// Query parameter builders
export const buildBlogQueryParams = (filters: BlogFilters & { page?: number; limit?: number }) => {
  const params = new URLSearchParams();

  if (filters.category) params.append('category', filters.category);
  if (filters.tag) params.append('tag', filters.tag);
  if (filters.author) params.append('author', filters.author);
  if (filters.status) params.append('status', filters.status);
  if (filters.featured !== undefined) params.append('featured', filters.featured.toString());
  if (filters.search) params.append('search', filters.search);
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());

  return params.toString();
};

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface BlogApiResponse extends ApiResponse<Post> {}
export interface BlogListApiResponse extends ApiResponse<BlogListResponse> {}
export interface BlogCreateApiResponse extends ApiResponse<Post> {}
export interface BlogUpdateApiResponse extends ApiResponse<Post> {}
export interface BlogDeleteApiResponse extends ApiResponse<{ deleted: boolean }> {}

// Frontend route paths (for React Router or similar)
export const BLOG_FRONTEND_ROUTES = {
  BLOGS_LIST: '/blogs',
  BLOG_DETAIL: (slug: string) => `/blogs/${slug}`,
  BLOG_EDIT: (id: string) => `/blogs/edit/${id}`,
  BLOG_CREATE: '/blogs/create',
  BLOG_PREVIEW: (id: string) => `/blogs/preview/${id}`,
  BLOG_DRAFTS: '/blogs/drafts',
  BLOG_PUBLISHED: '/blogs/published',
  BLOG_ARCHIVED: '/blogs/archived',
} as const;

// Route guards and permissions
export const BLOG_PERMISSIONS = {
  CREATE: 'blog:create',
  READ: 'blog:read',
  UPDATE: 'blog:update',
  DELETE: 'blog:delete',
  PUBLISH: 'blog:publish',
  MANAGE_OWN: 'blog:manage_own',
  MANAGE_ALL: 'blog:manage_all',
} as const;

// Validation schemas (you can use with a validation library like Zod)
export const BLOG_VALIDATION = {
  TITLE_MIN_LENGTH: 1,
  TITLE_MAX_LENGTH: 200,
  SUBTITLE_MAX_LENGTH: 300,
  EXCERPT_MAX_LENGTH: 500,
  SLUG_PATTERN: /^[a-z0-9-]+$/,
  CATEGORIES_MAX: 5,
  TAGS_MAX: 10,
} as const;

// Express Router
const router = Router();

// Middleware to require marketing admin
// TODO: Re-enable after setting up proper authentication
// router.use(requireMarketingAdmin);

// GET /api/blogs - Get all blogs with optional filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, tag, author, status, featured, search, page = 1, limit = 10 } = req.query;
    const filters: any = {};
    if (category) filters.categories = { $in: [category] };
    if (tag) filters.tags = { $in: [tag] };
    if (author) filters['author.name'] = author;
    if (status) filters.status = status;
    if (featured !== undefined) filters.featured = featured === 'true';
    if (search) filters.$or = [
      { title: { $regex: search, $options: 'i' } },
      { excerpt: { $regex: search, $options: 'i' } },
    ];

    const skip = (Number(page) - 1) * Number(limit);
    const posts = await BlogModel.find(filters).skip(skip).limit(Number(limit)).sort({ createdAt: -1 });
    const total = await BlogModel.countDocuments(filters);

    const response: BlogListApiResponse = {
      success: true,
      data: {
        posts: posts.map(p => p.toObject()),
        total,
        page: Number(page),
        limit: Number(limit),
        filters,
      },
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch blogs' });
  }
});

// GET /api/blogs/:idOrSlug - Get a single blog
router.get('/:idOrSlug', async (req: Request, res: Response) => {
  try {
    const { idOrSlug } = req.params;
    const post = await BlogModel.findOne({ $or: [{ _id: idOrSlug }, { slug: idOrSlug }] });
    if (!post) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: post.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch blog' });
  }
});

// POST /api/blogs - Create a new blog
router.post('/', async (req: Request, res: Response) => {
  try {
    const blogData: any = req.body;
    
    // Create blog with all fields from frontend
    const newBlog = new BlogModel({
      title: blogData.title || 'Untitled',
      subtitle: blogData.subtitle || '',
      slug: blogData.slug || blogData.title?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'untitled',
      excerpt: blogData.excerpt || '',
      cover: blogData.cover || { src: '', caption: '' },
      author: blogData.author || { name: 'Admin', role: 'Editor', initials: 'AD', avatar: '' },
      categories: blogData.categories || [],
      tags: blogData.tags || [],
      readingTime: blogData.readingTime || 1,
      publishDate: blogData.publishDate || new Date().toISOString().split('T')[0],
      status: blogData.status || 'draft',
      featured: blogData.featured ?? false,
      seo: blogData.seo || { title: '', description: '', ogImage: '' },
      blocks: blogData.blocks || [],
      related: blogData.related || [],
    });
    
    const savedBlog = await newBlog.save();
    res.status(201).json({ success: true, data: savedBlog.toObject() });
  } catch (error) {
    console.error('[blogs create] error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to create blog';
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// PUT /api/blogs/:id - Update a blog
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData: BlogUpdateRequest = req.body;
    const updatedBlog = await BlogModel.findByIdAndUpdate(id, updateData, { new: true });
    if (!updatedBlog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: updatedBlog.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update blog' });
  }
});

// DELETE /api/blogs/:id - Delete a blog
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deletedBlog = await BlogModel.findByIdAndDelete(id);
    if (!deletedBlog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete blog' });
  }
});

// PATCH /api/blogs/:id/publish - Publish a blog
router.patch('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updatedBlog = await BlogModel.findByIdAndUpdate(id, { status: 'published' }, { new: true });
    if (!updatedBlog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: updatedBlog.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to publish blog' });
  }
});

// PATCH /api/blogs/:id/unpublish - Unpublish a blog
router.patch('/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updatedBlog = await BlogModel.findByIdAndUpdate(id, { status: 'draft' }, { new: true });
    if (!updatedBlog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: updatedBlog.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to unpublish blog' });
  }
});

export default router;