// This router is intentionally extracted from the monolithic 'apps' router
// to serve as the Backend module for the "Photo Story" app.
// It encapsulates Post, Comment, and ShortText management specific to this app type.

import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";

import { prisma } from "../../utils/prisma.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { normalizeUploadsPath } from "../../utils/uploadsSigning.js";
import {
  authenticateToken,
  authorizeRole,
  optionalAuthenticateToken,
  type AuthRequest,
  requireActiveUser,
} from "../../middleware/auth.js";

const router = Router({ mergeParams: true });

// -- Schemas (Reproduced locally for module independence) --

const PostCreateSchema = z.object({
  mediaId: z.string().min(1),
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  takenAt: z.string().datetime().optional().nullable(),
  tags: z.array(z.string().min(1)).optional(),
});

const PostUpdateSchema = z.object({
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  takenAt: z.string().datetime().optional().nullable(),
  tags: z.array(z.string().min(1)).optional(),
});

const CommentCreateSchema = z.object({
  content: z.string().min(1).max(2000),
});

const EssayCreateSchema = z.object({
  title: z.string().optional().nullable(),
  content: z.string().min(1).max(10000),
});

const ReportSchema = z.object({
  reason: z.string().max(1000).optional().nullable(),
});

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// -- Helper: File Serving --
const getUploadsRootDir = () =>
  env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

const resolveUploadsFilePath = (uploadsPath: string) => {
  const root = getUploadsRootDir();
  const abs = path.resolve(root, uploadsPath);
  const rootResolved = path.resolve(root);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
    return null;
  }
  return abs;
};

const resolveSizedFilename = (filename: string, size?: string) => {
  const ext = path.extname(filename);
  const name = path.basename(filename, ext);

  if (!size || size === "large") {
    return filename;
  }

  if (size === "thumbnail") {
    return `${name}-thumb${ext}`;
  }

  if (size === "medium") {
    return `${name}-medium${ext}`;
  }

  return filename;
};

// -- Helper: App Access Check (Could be shared, but duplicated for isolation for now) --
const pickAccessibleAppInstance = async (
  slug: string,
  authUser?: AuthRequest["user"],
) => {
  const app = await prisma.appInstance.findUnique({ where: { slug } });
  if (!app) return { app: null, allowed: false };

  // Only run logic for PHOTO_STORY
  if (app.type !== "PHOTO_STORY") {
    return { app: null, allowed: false };
  }

  const isPrivileged =
    authUser?.role === "ADMIN" || authUser?.role === "EDITOR";
  if (!isPrivileged && !app.isActive) {
    return { app: null, allowed: false };
  }

  const config = (app.config as Record<string, unknown> | null) ?? null;
  const allowedGroupIds = Array.isArray(config?.allowedGroupIds)
    ? (config?.allowedGroupIds as string[])
    : [];

  if (allowedGroupIds.length === 0 || isPrivileged) {
    return { app, allowed: true, allowedGroupIds };
  }

  if (!authUser) {
    return { app, allowed: false, allowedGroupIds };
  }

  const userGroupIds = await prisma.userGroup
    .findMany({ where: { userId: authUser.id }, select: { groupId: true } })
    .then((items) => items.map((item) => item.groupId));

  const hasAccess = allowedGroupIds.some((id) => userGroupIds.includes(id));
  return { app, allowed: hasAccess, allowedGroupIds };
};

// -- Routes --

// List Posts
router.get("/posts", optionalAuthenticateToken, async (req, res) => {
  const authUser = (req as AuthRequest).user;
  const { slug } = req.params as { slug: string };
  const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;

  const parsed = PaginationSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: "Invalid pagination", errors: parsed.error.errors });
    return;
  }

  try {
    const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
    if (!app || !allowed) {
      res.status(404).json({ message: "App not found" });
      return;
    }

    const where = {
      appInstanceId: app.id,
      ...(tag
        ? {
            tags: {
              some: {
                tag: { name: tag },
              },
            },
          }
        : {}),
    };

    const skip = (parsed.data.page - 1) * parsed.data.limit;

    const [posts, total] = await Promise.all([
      prisma.photoPost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: parsed.data.limit,
        include: {
          media: true,
          tags: { include: { tag: true } },
        },
      }),
      prisma.photoPost.count({ where }),
    ]);

    res.json({
      data: posts.map((post) => ({
        id: post.id,
        title: post.title,
        description: post.description,
        location: post.location,
        takenAt: post.takenAt,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        media: post.media,
        tags: post.tags.map((t) => t.tag.name),
      })),
      meta: {
        total,
        page: parsed.data.page,
        limit: parsed.data.limit,
        totalPages: Math.ceil(total / parsed.data.limit),
      },
    });
  } catch (error) {
    logger.error("Failed to list photo posts", error);
    res.status(500).json({ message: "Failed to list photo posts" });
  }
});

// Get Single Post
router.get("/posts/:id", optionalAuthenticateToken, async (req, res) => {
  const authUser = (req as AuthRequest).user;
  const { slug, id } = req.params as { slug: string; id: string };

  try {
    const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
    if (!app || !allowed) {
      res.status(404).json({ message: "App not found" });
      return;
    }

    const post = await prisma.photoPost.findFirst({
      where: { id, appInstanceId: app.id },
      include: {
        media: true,
        tags: { include: { tag: true } },
      },
    });

    if (!post) {
      res.status(404).json({ message: "Post not found" });
      return;
    }

    res.json({
      post: {
        id: post.id,
        title: post.title,
        description: post.description,
        location: post.location,
        takenAt: post.takenAt,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        media: post.media,
        tags: post.tags.map((t) => t.tag.name),
      },
    });
  } catch (error) {
    logger.error("Failed to get photo post", error);
    res.status(500).json({ message: "Failed to get photo post" });
  }
});

// Create Post
router.post(
  "/posts",
  authenticateToken,
  authorizeRole(["ADMIN", "EDITOR"]),
  async (req, res) => {
    const { slug } = req.params as { slug: string };

    try {
      const data = PostCreateSchema.parse(req.body);

      const { app, allowed } = await pickAccessibleAppInstance(
        slug,
        (req as AuthRequest).user,
      );
      // Extra check: only ADMIN/EDITOR can write, effectively handled by middleware + isPrivileged logic inside pick
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const media = await prisma.media.findUnique({
        where: { id: data.mediaId },
      });
      if (!media) {
        res.status(404).json({ message: "Media not found" });
        return;
      }
      if (!media.mimetype.startsWith("image/")) {
        res.status(400).json({ message: "Media must be an image" });
        return;
      }

      const tags = Array.from(
        new Set((data.tags ?? []).map((t) => t.trim()).filter(Boolean)),
      );

      const created = await prisma.$transaction(async (tx) => {
        const post = await tx.photoPost.create({
          data: {
            appInstanceId: app.id,
            mediaId: data.mediaId,
            title: data.title ?? undefined,
            description: data.description ?? undefined,
            location: data.location ?? undefined,
            takenAt: data.takenAt ? new Date(data.takenAt) : undefined,
          },
        });

        if (tags.length) {
          const tagRows = await Promise.all(
            tags.map((name) =>
              tx.photoTag.upsert({
                where: {
                  appInstanceId_name: {
                    appInstanceId: app.id,
                    name,
                  },
                },
                update: {},
                create: {
                  appInstanceId: app.id,
                  name,
                },
              }),
            ),
          );

          await tx.photoTagAssignment.createMany({
            data: tagRows.map((tag) => ({
              postId: post.id,
              tagId: tag.id,
            })),
            skipDuplicates: true,
          });
        }

        return post;
      });

      res.status(201).json({ post: created });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to create photo post", error);
      res.status(500).json({ message: "Failed to create photo post" });
    }
  },
);

// Update Post
router.patch(
  "/posts/:id",
  authenticateToken,
  authorizeRole(["ADMIN", "EDITOR"]),
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };

    try {
      const data = PostUpdateSchema.parse(req.body);
      const { app } = await pickAccessibleAppInstance(
        slug,
        (req as AuthRequest).user,
      );
      if (!app) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const existing = await prisma.photoPost.findFirst({
        where: { id, appInstanceId: app.id },
      });

      if (!existing) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const tags = data.tags
        ? Array.from(new Set(data.tags.map((t) => t.trim()).filter(Boolean)))
        : undefined;

      const updated = await prisma.$transaction(async (tx) => {
        const post = await tx.photoPost.update({
          where: { id },
          data: {
            title: data.title,
            description: data.description,
            location: data.location,
            takenAt: data.takenAt ? new Date(data.takenAt) : data.takenAt,
          },
          include: {
            media: true,
          },
        });

        if (tags !== undefined) {
          // Sync tags
          await tx.photoTagAssignment.deleteMany({ where: { postId: id } });

          if (tags.length > 0) {
            const tagRows = await Promise.all(
              tags.map((name) =>
                tx.photoTag.upsert({
                  where: {
                    appInstanceId_name: {
                      appInstanceId: app.id,
                      name,
                    },
                  },
                  update: {},
                  create: {
                    appInstanceId: app.id,
                    name,
                  },
                }),
              ),
            );

            await tx.photoTagAssignment.createMany({
              data: tagRows.map((tag) => ({
                postId: post.id,
                tagId: tag.id,
              })),
            });
          }
        }

        return post;
      });

      res.json({ post: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to update photo post", error);
      res.status(500).json({ message: "Failed to update photo post" });
    }
  },
);

// Delete Post
router.delete(
  "/posts/:id",
  authenticateToken,
  authorizeRole(["ADMIN", "EDITOR"]),
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };

    try {
      const { app } = await pickAccessibleAppInstance(
        slug,
        (req as AuthRequest).user,
      );
      if (!app) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      await prisma.photoPost.deleteMany({
        where: { id, appInstanceId: app.id },
      });

      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete photo post", error);
      res.status(500).json({ message: "Failed to delete photo post" });
    }
  },
);

// List Comments
router.get(
  "/posts/:id/comments",
  optionalAuthenticateToken,
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const authUser = (req as AuthRequest).user;

    try {
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const post = await prisma.photoPost.findFirst({
        where: { id, appInstanceId: app.id },
      });

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const comments = await prisma.photoComment.findMany({
        where: { postId: id },
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: "desc" },
      });

      // TODO: Filter blocked comments?

      res.json({ data: comments });
    } catch (error) {
      logger.error("Failed to list comments", error);
      res.status(500).json({ message: "Failed to list comments" });
    }
  },
);

// Create Comment
router.post(
  "/posts/:id/comments",
  authenticateToken,
  requireActiveUser,
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const authUser = (req as AuthRequest).user!;

    try {
      const data = CommentCreateSchema.parse(req.body);
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const post = await prisma.photoPost.findFirst({
        where: { id, appInstanceId: app.id },
      });

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const comment = await prisma.photoComment.create({
        data: {
          postId: id,
          userId: authUser.id,
          content: data.content,
        },
        include: {
          user: { select: { id: true, username: true } },
        },
      });

      res.status(201).json({ comment });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to create comment", error);
      res.status(500).json({ message: "Failed to create comment" });
    }
  },
);

// Delete Comment
router.delete(
  "/posts/:postId/comments/:commentId",
  authenticateToken,
  async (req, res) => {
    const { slug, postId, commentId } = req.params as {
      slug: string;
      postId: string;
      commentId: string;
    };
    const authUser = (req as AuthRequest).user!;

    try {
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const comment = await prisma.photoComment.findUnique({
        where: { id: commentId },
      });

      if (!comment || comment.postId !== postId) {
        res.status(404).json({ message: "Comment not found" });
        return;
      }

      const isAuthor = comment.userId === authUser.id;
      const isAdmin = authUser.role === "ADMIN" || authUser.role === "EDITOR";

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      await prisma.photoComment.delete({ where: { id: commentId } });
      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete comment", error);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  },
);

// List Essays (alias of short-texts)
router.get("/posts/:id/essays", optionalAuthenticateToken, async (req, res) => {
  const { slug, id } = req.params as { slug: string; id: string };
  const authUser = (req as AuthRequest).user;

  try {
    const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
    if (!app || !allowed) {
      res.status(404).json({ message: "App not found" });
      return;
    }

    const essays = await prisma.photoEssay.findMany({
      where: { postId: id },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json({ data: essays });
  } catch (error) {
    logger.error("Failed to list photo essays", error);
    res.status(500).json({ message: "Failed to list photo essays" });
  }
});

// Create Essay (alias of short-texts)
router.post(
  "/posts/:id/essays",
  authenticateToken,
  requireActiveUser,
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const authUser = (req as AuthRequest).user!;

    try {
      const data = EssayCreateSchema.parse(req.body);
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const post = await prisma.photoPost.findFirst({
        where: { id, appInstanceId: app.id },
      });

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const essay = await prisma.photoEssay.create({
        data: {
          postId: id,
          userId: authUser.id,
          title: data.title,
          content: data.content,
        },
        include: {
          user: { select: { id: true, username: true } },
        },
      });

      res.status(201).json({ essay });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to create photo essay", error);
      res.status(500).json({ message: "Failed to create photo essay" });
    }
  },
);

// Delete Essay (alias of short-texts)
router.delete(
  "/posts/:postId/essays/:essayId",
  authenticateToken,
  async (req, res) => {
    const { slug, postId, essayId } = req.params as {
      slug: string;
      postId: string;
      essayId: string;
    };
    const authUser = (req as AuthRequest).user!;

    try {
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const essay = await prisma.photoEssay.findUnique({
        where: { id: essayId },
      });

      if (!essay || essay.postId !== postId) {
        res.status(404).json({ message: "Essay not found" });
        return;
      }

      const isAuthor = essay.userId === authUser.id;
      const isAdmin = authUser.role === "ADMIN" || authUser.role === "EDITOR";

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      await prisma.photoEssay.delete({ where: { id: essayId } });
      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete photo essay", error);
      res.status(500).json({ message: "Failed to delete photo essay" });
    }
  },
);

// List Short Texts (Essays)
router.get(
  "/posts/:id/short-texts",
  optionalAuthenticateToken,
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const authUser = (req as AuthRequest).user;

    try {
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const essays = await prisma.photoEssay.findMany({
        where: { postId: id },
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: "desc" },
      });

      res.json({ data: essays });
    } catch (error) {
      logger.error("Failed to list photo essays", error);
      res.status(500).json({ message: "Failed to list photo essays" });
    }
  },
);

// Create Short Text
router.post(
  "/posts/:id/short-texts",
  authenticateToken,
  requireActiveUser,
  async (req, res) => {
    const { slug, id } = req.params as { slug: string; id: string };
    const authUser = (req as AuthRequest).user!;

    try {
      const data = EssayCreateSchema.parse(req.body);
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const post = await prisma.photoPost.findFirst({
        where: { id, appInstanceId: app.id },
      });

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const essay = await prisma.photoEssay.create({
        data: {
          postId: id,
          userId: authUser.id,
          title: data.title,
          content: data.content,
        },
        include: {
          user: { select: { id: true, username: true } },
        },
      });

      res.status(201).json({ essay });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to create photo essay", error);
      res.status(500).json({ message: "Failed to create photo essay" });
    }
  },
);

// Delete Short Text
router.delete(
  "/posts/:postId/short-texts/:essayId",
  authenticateToken,
  async (req, res) => {
    const { slug, postId, essayId } = req.params as {
      slug: string;
      postId: string;
      essayId: string;
    };
    const authUser = (req as AuthRequest).user!;

    try {
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const essay = await prisma.photoEssay.findUnique({
        where: { id: essayId },
      });

      if (!essay || essay.postId !== postId) {
        res.status(404).json({ message: "Essay not found" });
        return;
      }

      const isAuthor = essay.userId === authUser.id;
      const isAdmin = authUser.role === "ADMIN" || authUser.role === "EDITOR";

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      await prisma.photoEssay.delete({ where: { id: essayId } });
      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete photo essay", error);
      res.status(500).json({ message: "Failed to delete photo essay" });
    }
  },
);

// Report Comment
router.post(
  "/posts/:postId/comments/:commentId/report",
  authenticateToken,
  async (req, res) => {
    const authUser = (req as AuthRequest).user!;
    try {
      const data = ReportSchema.parse(req.body ?? {});
      const { slug, postId, commentId } = req.params as {
        slug: string;
        postId: string;
        commentId: string;
      };
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const comment = await prisma.photoComment.findFirst({
        where: { id: commentId, postId },
      });

      if (!comment) {
        res.status(404).json({ message: "Comment not found" });
        return;
      }

      const created = await prisma.photoCommentReport.upsert({
        where: {
          commentId_reporterId: { commentId, reporterId: authUser.id },
        },
        update: { reason: data.reason ?? undefined },
        create: {
          commentId,
          reporterId: authUser.id,
          reason: data.reason ?? undefined,
        },
      });

      res.status(201).json({ report: { id: created.id } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to report comment", error);
      res.status(500).json({ message: "Failed to report comment" });
    }
  },
);

// Report Short Text
router.post(
  "/posts/:postId/short-texts/:essayId/report",
  authenticateToken,
  async (req, res) => {
    const authUser = (req as AuthRequest).user!;
    try {
      const data = ReportSchema.parse(req.body ?? {});
      const { slug, postId, essayId } = req.params as {
        slug: string;
        postId: string;
        essayId: string;
      };
      const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
      if (!app || !allowed) {
        res.status(404).json({ message: "App not found" });
        return;
      }

      const essay = await prisma.photoEssay.findFirst({
        where: { id: essayId, postId },
      });

      if (!essay) {
        res.status(404).json({ message: "Essay not found" });
        return;
      }

      const created = await prisma.photoEssayReport.upsert({
        where: {
          essayId_reporterId: { essayId, reporterId: authUser.id },
        },
        update: { reason: data.reason ?? undefined },
        create: {
          essayId,
          reporterId: authUser.id,
          reason: data.reason ?? undefined,
        },
      });

      res.status(201).json({ report: { id: created.id } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
        return;
      }
      logger.error("Failed to report essay", error);
      res.status(500).json({ message: "Failed to report essay" });
    }
  },
);

// Serve Image
router.get("/image/:mediaId", optionalAuthenticateToken, async (req, res) => {
  const authUser = (req as AuthRequest).user;
  const { slug, mediaId } = req.params as { slug: string; mediaId: string };
  const size = typeof req.query.size === "string" ? req.query.size : undefined;

  try {
    const { app, allowed } = await pickAccessibleAppInstance(slug, authUser);
    if (!app || !allowed) {
      res.status(404).json({ message: "App not found" });
      return;
    }

    const post = await prisma.photoPost.findFirst({
      where: { appInstanceId: app.id, mediaId },
      include: { media: true },
    });

    if (!post) {
      res.status(404).json({ message: "Image not found" });
      return;
    }

    const rawFilename =
      post.media.filename || post.media.url.replace("/uploads/", "");
    const safeFilename = normalizeUploadsPath(rawFilename);
    if (!safeFilename) {
      res.status(400).json({ message: "Invalid media filename" });
      return;
    }

    const requestedFilename = resolveSizedFilename(safeFilename, size);

    const uploadRoot = getUploadsRootDir();
    const requestedPath = resolveUploadsFilePath(requestedFilename);
    const fallbackPath = resolveUploadsFilePath(safeFilename);

    if (!requestedPath || !fallbackPath) {
      res.status(400).json({ message: "Invalid resolved file path" });
      return;
    }

    const fileToServe = fs.existsSync(requestedPath)
      ? requestedFilename
      : safeFilename;
    const absPath = fs.existsSync(requestedPath) ? requestedPath : fallbackPath;

    if (!fs.existsSync(absPath)) {
      res.status(404).json({ message: "File not found" });
      return;
    }

    res.setHeader("Cache-Control", "private, max-age=300");

    if (env.UPLOADS_SERVE_STRATEGY === "accel") {
      const rawPrefix = env.UPLOADS_ACCEL_REDIRECT_PREFIX;
      const withLeadingSlash = rawPrefix.startsWith("/")
        ? rawPrefix
        : `/${rawPrefix}`;
      const prefix = withLeadingSlash.endsWith("/")
        ? withLeadingSlash
        : `${withLeadingSlash}/`;
      res.setHeader("X-Accel-Redirect", `${prefix}${fileToServe}`);
      res.status(200).end();
      return;
    }

    res.sendFile(path.resolve(uploadRoot, fileToServe));
  } catch (error) {
    logger.error("Failed to serve photo image", error);
    res.status(500).json({ message: "Failed to serve image" });
  }
});

export default router;
