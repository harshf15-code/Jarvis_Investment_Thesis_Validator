import { SkeletonLoader } from "@/components/shared/skeleton-loader";

/**
 * What every screen inside the shell shows while its server render is in
 * flight.
 *
 * There was no `loading.tsx` and no Suspense boundary anywhere in the app, so a
 * navigation simply froze on the current page until the next one was ready —
 * with nothing on screen acknowledging the click. That was survivable while
 * four screens rendered their own skeleton client-side; now that those screens
 * read on the server, this is where that feedback belongs.
 *
 * It sits at the group root rather than per route so the header and the rail
 * stay put and only the canvas changes, which is what makes a navigation read
 * as instant rather than as a reload.
 */
export default function AppLoading() {
  return <SkeletonLoader lines={6} />;
}
