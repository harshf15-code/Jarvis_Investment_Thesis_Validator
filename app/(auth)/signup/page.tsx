import { AuthForm } from "@/components/auth/auth-form";

import { signup } from "../login/actions";

export default function SignupPage() {
  return <AuthForm mode="signup" action={signup} />;
}
