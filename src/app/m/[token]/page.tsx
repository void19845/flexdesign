import type { Metadata } from "next";
import { PublicBoard } from "@/components/public-board";

export const metadata: Metadata = { title: "Moodboard · Flexdesign" };

/** Moodboard par lien public, en lecture seule et sans compte (non indexé : voir le layout). */
export default async function PublicBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="page-admin">
      <PublicBoard token={token} />
    </div>
  );
}
