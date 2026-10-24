"use client";

import { useMemberSession } from "@/lib/member-session";
export { aiApiOrigin } from "@/lib/ai-conversation";

/** AI and comments use the same authenticated member and server-side quota. */
export function useAiAccess() {
  const member = useMemberSession();
  return {
    ...member,
    mode: "member" as const,
    owner: member.user?.id ?? "guest",
  };
}
