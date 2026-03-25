export async function ensureProfile(admin: any, ownerId: string) {
  try {
    const { error } = await admin.from("profiles").upsert(
      { id: ownerId, plan: "freemium" },
      { onConflict: "id", ignoreDuplicates: true },
    );

    if (error) throw error;
  } catch (error) {
    console.warn("[ensureProfile] profiles upsert failed:", {
      ownerId,
      error,
    });
    throw error;
  }
}
