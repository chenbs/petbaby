import { redirect } from "next/navigation";

import { FunTestsClient } from "@/components/fun-tests-client";
import { getOptionalUserId } from "@/server/auth/session";
import { listFunTests } from "@/server/fun-test-service";

import "./fun-tests.css";

export const dynamic = "force-dynamic";

export default async function FunTestsPage() {
  if (!await getOptionalUserId()) redirect("/login");
  return <FunTestsClient initialTests={listFunTests()} />;
}
