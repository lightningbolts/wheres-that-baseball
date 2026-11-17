import { notFound } from "next/navigation";
import { ParkLab } from "./ParkLab";

/** Dev-only stadium inspection page: any park, orbit camera, preset views, time of day. */
export default function ParkLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ParkLab />;
}
