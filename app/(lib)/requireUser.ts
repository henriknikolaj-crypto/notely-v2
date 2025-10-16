/**
 * Minimal requireUser til dev: returnér DEV_USER_ID hvis ingen auth.
 * Erstat med din rigtige implementering når auth er aktiv.
 */
export async function requireUser() {
  const id = process.env.DEV_USER_ID;
  if (!id) throw new Error("Not authenticated (and no DEV_USER_ID set)");
  return { id };
}

