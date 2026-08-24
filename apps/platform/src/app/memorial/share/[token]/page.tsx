import { MemorialShareClient } from "@/components/memorial-share-client";
export default async function MemorialSharePage({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <main className="screen"><MemorialShareClient token={token} /></main>; }
