"use client";

import { useState } from "react";

type NoteListItem = {
  id: string;
  title: string;
  createdPretty: string;
};

export default function NotesClient({ initialNotes }: { initialNotes: NoteListItem[] }) {
  const [notes, setNotes] = useState<NoteListItem[]>(initialNotes);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function handleDelete(id: string) {
    setErrorMsg("");

    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Delete failed:", text);
        setErrorMsg("Kunne ikke slette noten.");
        return;
      }

      // Opdater UI lokalt (fjern noten fra listen)
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error(err);
      setErrorMsg("Kunne ikke slette noten.");
    }
  }

  if (!notes.length) {
    return (
      <div className="text-sm text-black/60">
        Ingen noter endnu.
        {errorMsg && (
          <div className="text-red-600 mt-2 text-xs">{errorMsg}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div className="text-red-600 text-sm">{errorMsg}</div>
      )}

      {notes.map(note => (
        <div
          key={note.id}
          className="rounded-lg border border-black/10 bg-white shadow-sm px-4 py-3 text-sm flex flex-col gap-1"
        >
          <div className="flex items-start justify-between">
            <div className="font-medium text-black/90 leading-snug">
              {note.title}
            </div>

            <button
              onClick={() => handleDelete(note.id)}
              className="text-xs border border-black/20 rounded px-2 py-1 hover:bg-black/5 active:bg-black/10"
            >
              Slet
            </button>
          </div>

          <div className="text-[11px] text-black/50">
            {note.createdPretty}
          </div>
        </div>
      ))}
    </div>
  );
}

