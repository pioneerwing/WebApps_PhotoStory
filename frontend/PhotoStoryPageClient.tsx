"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Draggable from "react-draggable";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Maximize2,
  Minimize2,
  MessageSquare,
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { ApiError } from "@blog-pion79/shared";
import { AuthorizedImage } from "@/components/apps/photo-story/AuthorizedImage";

import {
  api,
  type AppInstanceDto,
  type PhotoPostDto,
  type PhotoCommentDto,
  type PhotoShortTextDto,
} from "@/lib/api";
import { useAuth } from "@/components/auth/AuthContext";

interface VendorFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

interface VendorDocument extends Document {
  webkitFullscreenElement?: Element;
  mozFullScreenElement?: Element;
  msFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
}

interface PhotoStoryPageClientProps {
  slug: string;
  app: AppInstanceDto;
}

export function PhotoStoryPageClient({ slug, app }: PhotoStoryPageClientProps) {
  const { token, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(1);
  const [selectedPost, setSelectedPost] = useState<PhotoPostDto | null>(null);
  const [posts, setPosts] = useState<PhotoPostDto[]>([]);
  const [meta, setMeta] = useState<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [comments, setComments] = useState<PhotoCommentDto[]>([]);
  const [shortTexts, setShortTexts] = useState<PhotoShortTextDto[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [isShortTextsLoading, setIsShortTextsLoading] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [shortTextTitle, setShortTextTitle] = useState("");
  const [shortTextContent, setShortTextContent] = useState("");
  const [shortTextError, setShortTextError] = useState<string | null>(null);
  const [overlayShortTextId, setOverlayShortTextId] = useState<string | null>(
    null,
  );
  const [showCommentsOverlay, setShowCommentsOverlay] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const inlineDraggableRef = useRef<HTMLDivElement>(null);
  const inlineCommentsDraggableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const element = fullscreenContainerRef.current as VendorFullscreenElement;
    if (element) {
      try {
        if (element.requestFullscreen) {
          await element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
          await element.webkitRequestFullscreen();
        } else if (element.mozRequestFullScreen) {
          await element.mozRequestFullScreen();
        } else if (element.msRequestFullscreen) {
          await element.msRequestFullscreen();
        }
      } catch (err: unknown) {
        console.error("Fullscreen error:", err);
      } finally {
        setIsFullscreen(true);
      }
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    const doc = document as VendorDocument;
    if (
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    ) {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen().catch(console.error);
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen().catch(console.error);
      } else if (doc.mozCancelFullScreen) {
        await doc.mozCancelFullScreen().catch(console.error);
      } else if (doc.msExitFullscreen) {
        await doc.msExitFullscreen().catch(console.error);
      }
    }
    setIsFullscreen(false);
  }, []);

  const nextPath = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const loginHref = useMemo(
    () => `/auth/login?next=${encodeURIComponent(nextPath)}`,
    [nextPath],
  );

  const fetchPosts = useCallback(
    async (pageNumber: number) => {
      setIsLoading(true);
      setNotFound(false);
      setNeedsLogin(false);

      try {
        const resp = await api.apps.listPosts(
          slug,
          { page: pageNumber, limit: 20 },
          token ?? undefined,
        );
        setPosts(resp.data);
        setMeta(resp.meta);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (!token) {
            router.replace(loginHref);
            return;
          }
          setNeedsLogin(true);
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
          return;
        }
        setNotFound(true);
      } finally {
        setIsLoading(false);
      }
    },
    [slug, token, router, loginHref],
  );

  useEffect(() => {
    void fetchPosts(page);
  }, [page, fetchPosts]);

  useEffect(() => {
    if (!selectedPost) return;

    setCommentInput("");
    setShortTextTitle("");
    setShortTextContent("");
    setOverlayShortTextId(null);
    setShowCommentsOverlay(false);
    setIsFullscreen(false);

    const run = async () => {
      setIsCommentsLoading(true);
      setIsShortTextsLoading(true);

      try {
        const [commentResp, shortTextResp] = await Promise.all([
          api.apps.listComments(slug, selectedPost.id, token ?? undefined),
          api.apps.listShortTexts(slug, selectedPost.id, token ?? undefined),
        ]);
        setComments(commentResp.data);
        setShortTexts(shortTextResp.data);
      } catch {
        setComments([]);
        setShortTexts([]);
      } finally {
        setIsCommentsLoading(false);
        setIsShortTextsLoading(false);
      }
    };

    void run();
  }, [selectedPost, slug, token]);

  const handleCreateComment = async () => {
    if (!selectedPost || !token || !commentInput.trim()) return;
    const content = commentInput.trim();
    setCommentInput("");
    setCommentError(null);
    try {
      const resp = await api.apps.createComment(
        slug,
        selectedPost.id,
        content,
        token,
      );
      setComments((prev) => [resp.comment, ...prev]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setCommentError("계정이 활성화되지 않아 댓글을 작성할 수 없습니다.");
        return;
      }
      setCommentInput(content);
    }
  };

  const handleCreateShortText = async () => {
    if (!selectedPost || !token || !shortTextContent.trim()) return;
    const payload = {
      title: shortTextTitle.trim() || undefined,
      content: shortTextContent.trim(),
    };
    setShortTextTitle("");
    setShortTextContent("");
    setShortTextError(null);
    try {
      const resp = await api.apps.createShortText(
        slug,
        selectedPost.id,
        payload,
        token,
      );
      setShortTexts((prev) => [resp.essay, ...prev]);
      setOverlayShortTextId(resp.essay.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setShortTextError(
          "계정이 활성화되지 않아 짧은글을 작성할 수 없습니다.",
        );
        return;
      }
      setShortTextTitle(payload.title ?? "");
      setShortTextContent(payload.content);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedPost || !token) return;
    await api.apps.deleteComment(slug, selectedPost.id, commentId, token);
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
  };

  const handleDeleteShortText = async (shortTextId: string) => {
    if (!selectedPost || !token) return;
    await api.apps.deleteShortText(slug, selectedPost.id, shortTextId, token);
    setShortTexts((prev) => prev.filter((item) => item.id !== shortTextId));
    if (overlayShortTextId === shortTextId) {
      setOverlayShortTextId(null);
    }
  };

  const handleReportComment = async (commentId: string) => {
    if (!selectedPost || !token) return;
    const reason = window.prompt("신고 사유를 입력하세요 (선택)") ?? undefined;
    await api.apps.reportComment(
      slug,
      selectedPost.id,
      commentId,
      reason,
      token,
    );
    alert("신고가 접수되었습니다.");
  };

  const handleReportShortText = async (shortTextId: string) => {
    if (!selectedPost || !token) return;
    const reason = window.prompt("신고 사유를 입력하세요 (선택)") ?? undefined;
    await api.apps.reportShortText(
      slug,
      selectedPost.id,
      shortTextId,
      reason,
      token,
    );
    alert("신고가 접수되었습니다.");
  };

  if (needsLogin) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-20">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-bold mb-3">로그인이 필요합니다</h1>
          <p className="text-slate-600 font-sans">
            이 앱은 회원만 열람할 수 있습니다.
          </p>
          <Link
            href={loginHref}
            className="inline-block mt-6 font-sans underline underline-offset-4"
          >
            로그인으로 이동
          </Link>
        </section>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-20">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-bold mb-3">앱을 찾을 수 없습니다</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-12">
      <header className="mb-12 text-center">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">
          Photo Story
        </p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold text-slate-900">
          {app.name}
        </h1>
        {app.description && (
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
            {app.description}
          </p>
        )}
      </header>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">불러오는 중...</div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 [column-fill:balance]">
          {posts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setSelectedPost(post)}
              className="mb-4 w-full break-inside-avoid rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="overflow-hidden rounded-2xl">
                <AuthorizedImage
                  src={`/api/apps/${encodeURIComponent(slug)}/image/${encodeURIComponent(post.media.id)}?size=medium`}
                  alt={post.title ?? post.media.originalName ?? "photo"}
                  token={token}
                  className="h-auto w-full object-cover transition duration-300 hover:scale-[1.02]"
                  loading="lazy"
                />
              </div>
              <div className="p-4 text-left">
                <h2 className="text-base font-semibold text-slate-900">
                  {post.title ?? "제목 없음"}
                </h2>
                {post.description && (
                  <p className="mt-2 text-sm text-slate-500 line-clamp-2">
                    {post.description}
                  </p>
                )}
                {post.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}

          {posts.length === 0 && (
            <div className="col-span-full rounded-3xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center text-slate-500">
              아직 등록된 사진이 없습니다.
            </div>
          )}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
          >
            이전
          </button>
          <span className="text-sm text-slate-500">
            {page} / {meta.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= meta.totalPages}
            onClick={() =>
              setPage((prev) => Math.min(meta.totalPages, prev + 1))
            }
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
          >
            다음
          </button>
        </div>
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {selectedPost.title ?? "제목 없음"}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {selectedPost.media.originalName ??
                        selectedPost.media.filename}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPost(null)}
                    className="rounded-full bg-[#6F6A62] px-3 py-1 text-sm text-white"
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
                  <div
                    ref={fullscreenContainerRef}
                    className={`relative overflow-hidden transition-all duration-300 ${
                      isFullscreen
                        ? "fixed inset-0 z-100 flex h-full w-full items-center justify-center bg-black"
                        : "rounded-2xl bg-slate-100"
                    }`}
                  >
                    <AuthorizedImage
                      src={`/api/apps/${encodeURIComponent(slug)}/image/${encodeURIComponent(selectedPost.media.id)}?size=large`}
                      alt={selectedPost.title ?? "photo"}
                      token={token}
                      className={`${
                        isFullscreen
                          ? "h-full w-full object-contain"
                          : "h-auto w-full object-contain"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={isFullscreen ? exitFullscreen : enterFullscreen}
                      className={`absolute z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/50 ${
                        isFullscreen ? "bottom-8 right-8" : "bottom-4 right-4"
                      }`}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="h-6 w-6" />
                      ) : (
                        <Maximize2 className="h-6 w-6" />
                      )}
                    </button>

                    {isFullscreen && (
                      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-2 z-20">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (shortTexts.length > 0) {
                              setOverlayShortTextId(shortTexts[0].id);
                            }
                          }}
                          disabled={shortTexts.length === 0}
                          className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm text-white hover:bg-black/70 disabled:opacity-50 transition-colors"
                        >
                          <FileText className="h-4 w-4" />
                          짧은글
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCommentsOverlay((prev) => !prev);
                          }}
                          className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm text-white hover:bg-black/70 transition-colors"
                        >
                          <MessageSquare className="h-4 w-4" />
                          댓글
                        </button>
                      </div>
                    )}

                    {overlayShortTextId && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6 z-30">
                        <Draggable
                          nodeRef={inlineDraggableRef}
                          cancel=".cancel-drag"
                        >
                          <div
                            ref={inlineDraggableRef}
                            className="pointer-events-auto max-w-xl rounded-2xl bg-white/90 p-6 text-center text-slate-900 shadow cursor-move"
                          >
                            {shortTexts
                              .filter((item) => item.id === overlayShortTextId)
                              .map((item) => {
                                const currentIndex = shortTexts.findIndex(
                                  (t) => t.id === item.id,
                                );
                                const prevItem = shortTexts[currentIndex - 1];
                                const nextItem = shortTexts[currentIndex + 1];

                                return (
                                  <div key={item.id}>
                                    {item.title && (
                                      <h3 className="text-lg font-semibold mb-2">
                                        {item.title}
                                      </h3>
                                    )}
                                    <p className="whitespace-pre-line text-sm leading-relaxed">
                                      {item.content}
                                    </p>
                                    <p className="mt-3 text-xs text-slate-500">
                                      @{item.user.username}
                                    </p>
                                    <div className="mt-4 flex items-center justify-center gap-2">
                                      {prevItem && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOverlayShortTextId(prevItem.id);
                                          }}
                                          className="cancel-drag inline-flex items-center gap-1 rounded-full bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-95"
                                        >
                                          <ChevronLeft className="h-3 w-3" />
                                          이전
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOverlayShortTextId(null);
                                        }}
                                        className="cancel-drag inline-block transform rounded-full bg-slate-100/80 px-4 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-95"
                                      >
                                        글 숨기기
                                      </button>

                                      {nextItem && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOverlayShortTextId(nextItem.id);
                                          }}
                                          className="cancel-drag inline-flex items-center gap-1 rounded-full bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-95"
                                        >
                                          다음
                                          <ChevronRight className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </Draggable>
                      </div>
                    )}

                    {showCommentsOverlay && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6 z-30">
                        <Draggable
                          nodeRef={inlineCommentsDraggableRef}
                          handle=".drag-handle"
                          cancel=".cancel-drag"
                        >
                          <div
                            ref={inlineCommentsDraggableRef}
                            className="pointer-events-auto flex h-[60vh] w-[90vw] md:w-md flex-col overflow-hidden rounded-2xl bg-white/90 text-slate-900 shadow-xl resize min-w-[300px] min-h-[300px]"
                          >
                            <div className="drag-handle flex items-center justify-between border-b border-slate-100 p-4 cursor-move bg-white/50">
                              <h3 className="font-semibold">댓글</h3>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowCommentsOverlay(false);
                                }}
                                className="cancel-drag text-slate-500 hover:text-slate-700"
                              >
                                <X className="h-5 w-5" />
                              </button>
                            </div>
                            <div className="cancel-drag flex-1 overflow-y-auto p-4">
                              {comments.length > 0 ? (
                                <ul className="space-y-3">
                                  {comments.map((comment) => (
                                    <li
                                      key={comment.id}
                                      className="rounded-lg bg-slate-50 p-3 text-sm"
                                    >
                                      <p className="whitespace-pre-line text-slate-800">
                                        {comment.content}
                                      </p>
                                      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                                        <span>@{comment.user.username}</span>
                                        <span>
                                          {new Date(
                                            comment.createdAt,
                                          ).toLocaleDateString()}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="py-8 text-center text-sm text-slate-500">
                                  댓글이 없습니다.
                                </p>
                              )}
                            </div>
                            <div className="border-t border-slate-100 p-4">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowCommentsOverlay(false);
                                }}
                                className="cancel-drag w-full rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                              >
                                댓글 숨기기
                              </button>
                            </div>
                          </div>
                        </Draggable>
                      </div>
                    )}
                  </div>
                  <div className="space-y-8 text-sm text-slate-600">
                    <div className="space-y-3 border-b border-slate-100 pb-8">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                          짧은글
                        </p>
                        <button
                          type="button"
                          onClick={() => setOverlayShortTextId(null)}
                          className="text-xs text-slate-500 underline"
                        >
                          글 숨기기
                        </button>
                      </div>
                      <p className="text-xs font-medium text-indigo-600">
                        원하는 글을 선택하면 사진 위에 표시됩니다.
                      </p>
                      {token && (
                        <div className="space-y-2">
                          <input
                            value={shortTextTitle}
                            onChange={(e) => setShortTextTitle(e.target.value)}
                            placeholder="짧은글 제목 (선택)"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          <textarea
                            value={shortTextContent}
                            onChange={(e) =>
                              setShortTextContent(e.target.value)
                            }
                            rows={4}
                            placeholder="사진에 대한 글을 남겨보세요"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          {shortTextError && (
                            <p className="text-xs text-red-500">
                              {shortTextError}
                            </p>
                          )}
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={handleCreateShortText}
                              disabled={!shortTextContent.trim()}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              짧은글 제출
                            </button>
                          </div>
                        </div>
                      )}
                      {isShortTextsLoading ? (
                        <p className="text-xs text-slate-400">불러오는 중...</p>
                      ) : shortTexts.length > 0 ? (
                        <ul className="space-y-2">
                          {shortTexts.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-lg border border-slate-100 bg-white px-3 py-2"
                            >
                              <button
                                type="button"
                                onClick={() => setOverlayShortTextId(item.id)}
                                className="w-full text-left"
                              >
                                <p className="text-sm font-semibold text-slate-800">
                                  {item.title ?? "제목 없음"}
                                </p>
                                <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                                  {item.content}
                                </p>
                              </button>
                              <div className="mt-2 flex items-center justify-between">
                                <p className="text-xs text-slate-400">
                                  @{item.user.username}
                                </p>
                                {token && user?.id === item.user.id && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteShortText(item.id)
                                    }
                                    className="text-xs text-red-500 hover:text-red-600"
                                  >
                                    삭제
                                  </button>
                                )}
                                {token && user?.id !== item.user.id && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleReportShortText(item.id)
                                    }
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                  >
                                    신고
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-400">
                          짧은글이 없습니다.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3 border-b border-slate-100 pb-8">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                          댓글
                        </p>
                        {token ? null : (
                          <Link
                            href={loginHref}
                            className="text-xs text-slate-500 underline"
                          >
                            로그인 후 작성
                          </Link>
                        )}
                      </div>
                      {token && (
                        <div className="space-y-2">
                          <textarea
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            rows={3}
                            placeholder="댓글을 남겨보세요"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          {commentError && (
                            <p className="text-xs text-red-500">
                              {commentError}
                            </p>
                          )}
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={handleCreateComment}
                              disabled={!commentInput.trim()}
                              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                            >
                              댓글 제출
                            </button>
                          </div>
                        </div>
                      )}
                      {isCommentsLoading ? (
                        <p className="text-xs text-slate-400">불러오는 중...</p>
                      ) : comments.length > 0 ? (
                        <ul className="space-y-2">
                          {comments.map((comment) => (
                            <li
                              key={comment.id}
                              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                            >
                              <p className="text-slate-700 whitespace-pre-line">
                                {comment.content}
                              </p>
                              <div className="mt-2 flex items-center justify-between">
                                <p className="text-xs text-slate-400">
                                  @{comment.user.username}
                                </p>
                                {token && user?.id === comment.user.id && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteComment(comment.id)
                                    }
                                    className="text-xs text-red-500 hover:text-red-600"
                                  >
                                    삭제
                                  </button>
                                )}
                                {token && user?.id !== comment.user.id && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleReportComment(comment.id)
                                    }
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                  >
                                    신고
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-400">
                          댓글이 없습니다.
                        </p>
                      )}
                    </div>

                    <div className="space-y-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                          설명
                        </p>
                        <p className="mt-2 text-slate-700">
                          {selectedPost.description ?? "설명 없음"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                          태그
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedPost.tags.length > 0 ? (
                            selectedPost.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                              >
                                {tag}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                          등록일
                        </p>
                        <p className="mt-2 text-slate-700">
                          {(() => {
                            try {
                              return new Date(
                                selectedPost.createdAt,
                              ).toLocaleDateString();
                            } catch {
                              return "날짜 정보 없음";
                            }
                          })()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
