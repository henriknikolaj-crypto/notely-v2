"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Note = {
  id: string;
  title: string;
  content: string | null;
};

export default function EditNoteForm({ note }: { note: Note }) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        content: content.trim() === "" ? null : content.trim(),
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      const err =
        typeof json?.error === "string"
          ? json.error
          : JSON.stringify(json?.error ?? "Ukendt fejl");
      setMessage(`Fejl: ${err}`);
      return;
    }

    setMessage("Gemt ✔");
    startTransition(() => { router.refresh(); });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Titel</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
          placeholder="Titel"
          maxLength={200}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Indhold</label>
        <textarea
          value={content ?? ""}
          onChange={(e) => setContent(e.target.value)}
          className="w-full border rounded-md px-3 py-2 min-h-[160px]"
          placeholder="Valgfrit"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 rounded-md border hover:bg-gray-50 disabled:opacity-60"
        >
          {isPending ? "Gemmer…" : "Gem ændringer"}
        </button>
        {message && <span className="text-sm">{message}</span>}
      </div>
    </form>
  );
}