// Empty pass-through middleware. Task 2 fills in the real auth-gate logic;
// this file only confirms the convention compiles and resolves in the right
// location (project root, alongside `app/`).
export function middleware() {}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
