import MappeIndsigtClient from "./MappeIndsigtClient";

type FolderInsightPageProps = {
  params: Promise<{
    folderId: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function FolderInsightPage({ params }: FolderInsightPageProps) {
  const { folderId } = await params;
  return <MappeIndsigtClient folderId={folderId} />;
}
