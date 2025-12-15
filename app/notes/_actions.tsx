"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import Button from "@/app/_ui/Button";
import Input from "@/app/_ui/Input";
import Textarea from "@/app/_ui/Textarea";

export function NewNoteForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        content: content.trim() === "" ? null : content.trim(),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(typeof j?.error === "string" ? j.error : "Fejl ved oprettelse");
      return;
    }
    setTitle(""); setContent("");
    toast.success("Note oprettet");
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border rounded-md p-4">
      <div>
        <label className="block text-sm font-medium mb-1">Titel</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note-titel" maxLength={200} required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Beskrivelse</label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Valgfrit" />
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? "Opretter…" : "Opret note"}</Button>
    </form>
  );
}

export function DeleteNoteBtn({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  async function del() {
    if (!confirm("Slet denne note?")) return;
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error ?? "Kunne ikke slette");
      return;
    }
    toast.success("Note slettet");
    startTransition(() => router.refresh());
  }
  return <Button onClick={del} disabled={isPending}>{isPending ? "Sletter…" : "Slet"}</Button>;
}

