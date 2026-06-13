"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "./user-avatar";
import { addComment } from "@/app/(app)/clients/actions";

export type NoteItem = {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  authorColor: string | null;
};

export function NotesTab({
  organizationId,
  notes,
}: {
  organizationId: string;
  notes: NoteItem[];
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    if (!body.trim()) return;
    const form = new FormData();
    form.set("organizationId", organizationId);
    form.set("body", body);
    setPending(true);
    const res = await addComment(form);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setBody("");
    toast.success("Note posted");
    router.refresh();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add an internal note… use @name to mention a teammate."
            rows={3}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to post</span>
            <Button size="sm" disabled={pending || !body.trim()} onClick={submit}>
              <Send className="h-4 w-4" /> {pending ? "Posting…" : "Post note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <MessageSquare className="h-6 w-6" />
          No notes yet. Start the conversation.
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((n) => (
            <div key={n.id} className="flex gap-3">
              <UserAvatar
                user={{ id: n.authorId, name: n.authorName, image: n.authorImage, color: n.authorColor }}
                className="h-8 w-8"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{n.authorName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  {n.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
