import { redirect } from "next/navigation";

/**
 * The Step 2/3 wizard this route used to serve is superseded by the
 * memorandum on `/thesis/[id]`, which produces the stress test and the costed
 * trade plan in the same pass. Kept as a redirect so older links, bookmarks and
 * anything still pointing here land on the current screen rather than a 404.
 */
export default async function ThesisPlanRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/thesis/${id}`);
}
