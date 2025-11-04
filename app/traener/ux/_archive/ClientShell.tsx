"use client";
import React from "react";
import ClientExamUX from "./ClientExamUX";

class Boundary extends React.Component<{ children: React.ReactNode }, { err?: any }> {
  state = { err: undefined as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  componentDidCatch(err: any, info: any) { console.error("Træner UI fejl:", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="p-4 rounded-xl border border-red-500 bg-red-50">
          <b>Fejl i Træner-UI:</b>
          <pre className="text-xs whitespace-pre-wrap mt-2">{String(this.state.err?.message ?? this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ClientShell(props: any) {
  return (
    <Boundary>
      <ClientExamUX {...props} />
    </Boundary>
  );
}
