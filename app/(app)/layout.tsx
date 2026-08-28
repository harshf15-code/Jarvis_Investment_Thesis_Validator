import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar, MobileNavBar } from "@/components/layout/app-sidebar";
import { NewThesisProvider } from "@/components/layout/new-thesis-context";
import { NewThesisDrawer } from "@/components/layout/new-thesis-drawer";

/**
 * App shell: fixed 64px header, fixed 80px icon rail from `sm` up, canvas in
 * between. `pb-24` on mobile keeps content clear of the bottom nav bar.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <NewThesisProvider>
      <AppHeader />
      <AppSidebar />
      <MobileNavBar />
      <main className="min-h-screen pt-16 pb-24 sm:pl-20 sm:pb-0">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
      <NewThesisDrawer />
    </NewThesisProvider>
  );
}
