import { Suspense } from "react";

import { NerdStandingsBrowser } from "@/components/features/NerdStandingsBrowser";

export default function NerdPage() {
  return (
    <Suspense fallback={null}>
      <NerdStandingsBrowser />
    </Suspense>
  );
}
