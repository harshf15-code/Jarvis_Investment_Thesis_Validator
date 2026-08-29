"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
};

/**
 * Deliberately generic on the login path: a distinct "no such account" would
 * turn the form into an account-enumeration oracle for a publicly reachable
 * deployment. Sign-up cannot hide the same fact (it must reject a duplicate
 * email to be usable at all), so it is allowed to be specific.
 */
const LOGIN_ERROR = "Incorrect email or password.";

const MIN_PASSWORD_LENGTH = 8;

const CredentialsSchema = z.object({
  email: z.string().trim().min(1).pipe(z.email()),
  password: z.string().min(1),
});

const SignupSchema = z.object({
  email: z.string().trim().min(1).pipe(z.email()),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
});

export async function login(formData: FormData): Promise<AuthState> {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: LOGIN_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: LOGIN_ERROR };
  }

  // The layout is cached per-request; without this the first render after
  // signing in can still be the logged-out tree.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(formData: FormData): Promise<AuthState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };
  }

  const confirm = formData.get("confirm_password");
  if (parsed.data.password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    return { error: error.message };
  }

  // No session means the project still has "Confirm email" switched on, so
  // Supabase is waiting on a link in the user's inbox instead of signing them
  // in. Say so plainly rather than bouncing them to a login that will fail.
  if (!data.session) {
    return {
      error:
        "Account created — check your email for a confirmation link, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
