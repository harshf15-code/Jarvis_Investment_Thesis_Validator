import { AuthForm } from "@/components/auth/auth-form";

import { login } from "./actions";

export default function LoginPage() {
  return <AuthForm mode="login" action={login} />;
}
