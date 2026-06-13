"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Send, MessageSquare } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { addComment } from "@/app/(app)/work/actions";
import { AssigneeAvatar } from "./work-bits";
import type { Comment } from "@/db/schema";
import type { WorkUser } from "./types";

export function CommentThread({
  workItemId,
  comments,
  users,
}: {
  workItemId: string;
  comments: Comment[];
  users: WorkUser[];
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const userById = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      try {
        await addComment({ workItemId, body: text });
        setBody("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't post note");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            <MessageSquare className="mb-2 h-6 w-6 opacity-50" />
            No notes yet. Start the conversation.
          </div>
        ) : (
          comments.map((c) => {
            const author = userById.get(c.authorId);
            return (
              <div key={c.id} className="flex gap-3">
                <AssigneeAvatar user={author ?? { id: c.authorId, name: "?", image: null, color: null }} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{author?.name ?? "Unknown"}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">{c.body}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          placeholder="Write a note… (Ctrl+Enter to send)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
          }}
          className="min-h-[70px]"
        />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending || !body.trim()} size="sm">
            <Send className="h-4 w-4" /> Post note
          </Button>
        </div>
      </div>
    </div>
  );
}
