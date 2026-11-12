import { Suspense } from "react";
import { redirect } from "next/navigation";

import { checkOwner } from "@/lib/auth/owner";
import { NotAllowed } from "@/ui/NotAllowed";
import { LoadingScreen } from "@/ui/LoadingScreen";
import { VillageApp } from "@/world/VillageApp";

export default function HomePage() {
  // Auth reads request data, so it must sit inside a Suspense boundary (Cache Components).
  return (
    <Suspense fallback={<LoadingScreen />}>
      <OwnerGate />
    </Suspense>
  );
}

async function OwnerGate() {
  const check = await checkOwner();
  if (check.ok) return <VillageApp ownerName={check.displayName} />;
  if (check.reason === "signed_out") redirect("/sign-in");
  return <NotAllowed reason={check.reason} />;
}
