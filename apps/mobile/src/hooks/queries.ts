import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export function useMe(enabled: boolean) {
  return useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled, retry: false });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.workspaces(),
    // poll so a newly-shared workspace appears without requiring sign-out/in, even if the push is missed
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useChannels(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["channels", workspaceId],
    queryFn: () => api.channels(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api.workspaceMembers(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useChannelMembers(channelId: string | null | undefined) {
  return useQuery({
    queryKey: ["channelMembers", channelId],
    queryFn: () => api.channelMembers(channelId!),
    enabled: !!channelId,
  });
}

export function useMessages(channelId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: ["messages", channelId],
    queryFn: ({ pageParam }) => api.messages(channelId!, pageParam ? { before: pageParam } : undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!channelId,
  });
}

/** Thread replies for a parent message (fetched on demand, no cursoring — API returns all). */
export function useReplies(parentId: string | null) {
  return useQuery({
    queryKey: ["replies", parentId],
    queryFn: () => api.replies(parentId!),
    enabled: !!parentId,
  });
}

export function useNotifications(pollMs = 20_000, enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications(),
    refetchInterval: pollMs,
    enabled,
  });
}

export function useSearch(q: string, channelId?: string) {
  return useQuery({
    queryKey: ["search", q, channelId ?? null],
    queryFn: () => api.search(q, channelId),
    enabled: q.trim().length > 0,
  });
}
