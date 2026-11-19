/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "1" once an SMS provider is set up in Supabase: mobile numbers are verified and passwords reset by SMS code */
  readonly VITE_PHONE_OTP?: string;
  /** The live website address (e.g. https://app.example.in). The Android app uses it for links in emails. */
  readonly VITE_PUBLIC_URL?: string;
}
