import { Post, BlogListResponse, BlogCreateRequest, BlogUpdateRequest, BlogFilters, BlogModel } from '../../models/blogs.model.js';
import BlogInteraction from '../../models/blogInteraction.model.js';
import User from '../../models/user.model.js';
import { Router, Request, Response } from 'express';
import requireMarketingAdmin from '../../mw/requireMarketingAdmin.js';
import requireUser, { AuthedRequest } from '../../mw/requireUser.js';
import { upload } from '../../mw/upload.middleware.js';
import { uploadImageToS3 } from '../../mw/s3upload.middleware.js';

// API Routes for Blog Management
export const BLOG_ROUTES = {
  // Get all blogs with optional filters
  GET_BLOGS: '/api/blogs',

  // Get blogs by status
  GET_BLOGS_BY_STATUS: (status: string) =>
    `/api/blogs?status=${status}`,

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
  details?: string[];
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasText = (v: unknown): boolean =>
  typeof v === 'string' && v.trim() !== '';

/**
 * Cleans block data sent by the editor before it hits Mongoose:
 *  - numlist-style `items`: drops completely empty rows and renumbers `n`
 *  - gallery `images`: drops blank strings
 *  - map `pins`: drops pins without valid coordinates
 * Does not mutate the original input.
 */
const cleanBlocks = (blocks: any[] = []): any[] => {
  if (!Array.isArray(blocks)) return [];

  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    const cleaned: any = { ...block };

    if (Array.isArray(cleaned.items)) {
      cleaned.items = cleaned.items
        .filter((it: any) =>
          [it?.title, it?.loc, it?.body, it?.img].some(hasText)
        )
        .map((it: any, i: number) => ({ ...it, n: i + 1 }));
    }

    if (Array.isArray(cleaned.images)) {
      cleaned.images = cleaned.images.filter(hasText);
    }

    if (Array.isArray(cleaned.pins)) {
      cleaned.pins = cleaned.pins.filter(
        (p: any) => typeof p?.x === 'number' && typeof p?.y === 'number'
      );
    }

    return cleaned;
  });
};

/**
 * Converts Mongoose / Mongo errors into a proper HTTP response.
 * Returns true if it handled the error.
 */
const handleWriteError = (error: any, res: Response, fallbackMsg: string): void => {
  if (error?.name === 'ValidationError') {
    const details = Object.values(error.errors || {}).map((e: any) => e.message);
    res.status(400).json({ success: false, error: 'Validation failed', details });
    return;
  }

  if (error?.name === 'CastError') {
    res.status(400).json({ success: false, error: `Invalid value for ${error.path}` });
    return;
  }

  // Duplicate key (slug is unique)
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
    res.status(409).json({
      success: false,
      error: `A blog with this ${field} already exists. Please change it and try again.`,
    });
    return;
  }

  const errorMsg = error instanceof Error ? error.message : fallbackMsg;
  res.status(500).json({ success: false, error: errorMsg });
};

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
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
    const post = isObjectId
      ? await BlogModel.findById(idOrSlug)
      : await BlogModel.findOne({ slug: idOrSlug });
    if (!post) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: post.toObject() });
  } catch (error) {
    console.error('[GET BLOG ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to fetch blog' });
  }
});

// POST /api/blogs/:id/like - Like a blog
router.post('/:id/like', requireUser, async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const blog = await BlogModel.findById(id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        error: 'Blog not found',
      });
    }

    const existingInteraction = await BlogInteraction.findOne({
      userId,
      blogId: blog._id,
    });

    if (existingInteraction?.liked) {
      return res.json({
        success: true,
        data: {
          likes: blog.likes ?? 0,
          liked: true,
        },
      });
    }

    await BlogInteraction.findOneAndUpdate(
      {
        userId,
        blogId: blog._id,
      },
      {
        $set: {
          liked: true,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    const updatedBlog = await BlogModel.findByIdAndUpdate(
      id,
      { $inc: { likes: 1 } },
      { new: true }
    );

    res.json({
      success: true,
      data: {
        likes: updatedBlog?.likes ?? 0,
        liked: true,
      },
    });
  } catch (error) {
    console.error('[blogs like] error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to like blog',
    });
  }
});

// POST /api/blogs/:id/rating - Rate a blog
router.post('/:id/rating', requireUser, async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be an integer between 1 and 5',
      });
    }

    const blog = await BlogModel.findById(id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        error: 'Blog not found',
      });
    }

    const existingInteraction = await BlogInteraction.findOne({
      userId,
      blogId: blog._id,
    });

    if (existingInteraction?.rating) {
      return res.status(400).json({
        success: false,
        error: 'You have already rated this blog',
      });
    }

    await BlogInteraction.findOneAndUpdate(
      {
        userId,
        blogId: blog._id,
      },
      {
        $set: {
          rating,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    const updatedBlog = await BlogModel.findByIdAndUpdate(
      id,
      {
        $inc: {
          ratingTotal: rating,
          ratingCount: 1,
        },
      },
      { new: true }
    );

    const ratingCount = updatedBlog?.ratingCount ?? 0;
    const ratingTotal = updatedBlog?.ratingTotal ?? 0;

    const averageRating =
      ratingCount > 0
        ? ratingTotal / ratingCount
        : 0;

    res.json({
      success: true,
      data: {
        ratingCount,
        averageRating: Number(averageRating.toFixed(1)),
        rating,
      },
    });
  } catch (error) {
    console.error('[blogs rating] error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to rate blog',
    });
  }
});

router.get(
  '/:id/interaction',
  requireUser,
  async (req: AuthedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const blog = await BlogModel.findById(id);

      if (!blog) {
        return res.status(404).json({
          success: false,
          error: 'Blog not found',
        });
      }

      const interaction = await BlogInteraction.findOne({
        userId,
        blogId: blog._id,
      });

      const saved = await User.exists({
        _id: userId,
        savedBlogs: blog._id,
      });

      res.json({
        success: true,
        data: {
          liked: interaction?.liked ?? false,
          rating: interaction?.rating ?? 0,
          saved: Boolean(saved),
        },
      });
    } catch (error) {
      console.error('[blogs interaction] error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to load blog interaction',
      });
    }
  }
);

// POST /api/blogs/:id/save - Save a blog for the logged-in user
router.post('/:id/save', requireUser, async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const blog = await BlogModel.findById(id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        error: 'Blog not found',
      });
    }

    await User.findByIdAndUpdate(
      userId,
      { $addToSet: { savedBlogs: blog._id } },
      { new: true }
    );

    res.json({
      success: true,
      data: {
        saved: true,
        blogId: blog._id,
      },
    });
  } catch (error) {
    console.error('[blogs save] error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save blog',
    });
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
      blocks: cleanBlocks(blogData.blocks || []),
      related: blogData.related || [],
    });

    const savedBlog = await newBlog.save();
    res.status(201).json({ success: true, data: savedBlog.toObject() });
  } catch (error: any) {
    console.error('[blogs create] error:', error);
    handleWriteError(error, res, 'Failed to create blog');
  }
});

// PUT /api/blogs/:id - Update a blog
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData: any = { ...req.body };

    // Never allow these to be overwritten from the client
    delete updateData._id;
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    if (updateData.blocks) {
      updateData.blocks = cleanBlocks(updateData.blocks);
    }

    const updatedBlog = await BlogModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedBlog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }
    res.json({ success: true, data: updatedBlog.toObject() });
  } catch (error: any) {
    console.error('[blogs update] error:', error);
    handleWriteError(error, res, 'Failed to update blog');
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

// POST /api/blogs/upload-image - Upload blog image to S3
router.post('/upload-image', upload.single('image'), uploadImageToS3('src'), async (req: Request, res: Response) => {
  try {
    if (!req.body.src) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    res.json({ success: true, data: { url: req.body.src } });
  } catch (error) {
    console.error('[blogs upload-image] error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to upload image';
    res.status(500).json({ success: false, error: errorMsg });
  }
});


export default router;