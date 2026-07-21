import type { Metadata } from "next";

import { AboutPage } from "@/components/features/AboutPage";
import { SITE_NAME, SITE_NAME_SHORT } from "@/lib/site";

export const metadata: Metadata = {
  title: `About · ${SITE_NAME}`,
  description: `About ${SITE_NAME_SHORT}: data sources, API attribution, and the developer behind the project.`,
};

export default function AboutRoute() {
  return <AboutPage />;
}
