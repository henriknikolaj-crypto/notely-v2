function isPermissionLike(error: any) {
  const status = Number(error?.status ?? error?.code ?? 0);
  const msg = String(error?.message ?? error?.error ?? error?.details ?? "").toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    msg.includes("forbidden") ||
    msg.includes("permission") ||
    msg.includes("row-level security") ||
    msg.includes("violates row-level security")
  );
}

export async function ensureProfile(admin: any, ownerId: string) {
  try {
    const { error } = await admin.from("profiles").upsert(
      { id: ownerId, plan: "freemium" },
      { onConflict: "id", ignoreDuplicates: true },
    );

    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[ensureProfile] profiles upsert failed:", {
      ownerId,
      error,
    });
    if (isPermissionLike(error)) return false;
    throw error;
  }
}
