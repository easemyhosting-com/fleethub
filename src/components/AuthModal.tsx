"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Shield,
  Lock,
  Mail,
  Key,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  X,
  Copy,
  Check,
  User,
  LogOut,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionChange?: () => void;
}

export function AuthModal({ isOpen, onClose, onSessionChange }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<"auth" | "google_guide" | "session">("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    user: { email: string; name: string; provider: string } | null;
    googleEnabled: boolean;
    authRequired: boolean;
    registrationAvailable: boolean;
    googleRedirectUri?: string | null;
  }>({
    authenticated: false,
    user: null,
    googleEnabled: false,
    authRequired: false,
    registrationAvailable: false,
  });

  const [statusLoaded, setStatusLoaded] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/auth");
      if (res.ok) {
        const data = await res.json();
        setAuthStatus(data);
        setStatusLoaded(true);
        if (!data.registrationAvailable) setIsRegisterMode(false);
        if (data.authenticated) {
          setActiveTab("session");
        }
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStatusLoaded(false);
      checkStatus();
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    (focusable()[0] ?? dialogRef.current)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (dialogRef.current && e.target instanceof Node && !dialogRef.current.contains(e.target)) (focusable()[0] ?? dialogRef.current).focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      previous?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const redirectUri = authStatus.googleRedirectUri || "Configure FLEETHUB_APP_URL on the server";

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const action = isRegisterMode ? "register" : "login";
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, password, ...(isRegisterMode && name.trim() ? { name: name.trim() } : {}), ...(isRegisterMode ? { bootstrapToken } : {}) }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(isRegisterMode ? "Admin account created and logged in!" : "Successfully signed in!");
      setPassword("");
      setBootstrapToken("");
      await checkStatus();
      if (onSessionChange) onSessionChange();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      await checkStatus();
      if (onSessionChange) onSessionChange();
      setActiveTab("auth");
      setSuccess("Logged out successfully");
    } catch {
      setError("Failed to log out");
    } finally {
      setLoading(false);
    }
  };

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" tabIndex={-1} className="relative w-full max-w-xl bg-[#0b0f17] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-100 flex flex-col">
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 id="auth-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                FleetHub Authentication & Access Gate
              </h3>
              <p className="text-xs text-zinc-400">
                Secure your control plane via Basic Email/Password or self-hosted Google OAuth.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-zinc-800/60 bg-zinc-950/40 text-xs">
          <button
            onClick={() => setActiveTab("auth")}
            className={`pb-2.5 px-2 font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "auth"
                ? "border-emerald-400 text-white font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Sign In / Password
          </button>
          <button
            onClick={() => setActiveTab("google_guide")}
            className={`pb-2.5 px-2 font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "google_guide"
                ? "border-emerald-400 text-white font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Google OAuth Guide
          </button>
          {authStatus.authenticated && (
            <button
              onClick={() => setActiveTab("session")}
              className={`pb-2.5 px-2 font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === "session"
                  ? "border-emerald-400 text-white font-semibold"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Current Session
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: EMAIL & PASSWORD / GOOGLE SIGN-IN */}
          {activeTab === "auth" && (
            <div className="space-y-4">
              {/* Google Sign In Button (if enabled) */}
              {authStatus.googleEnabled ? (
                <div>
                  <a
                    href="/api/auth/google"
                    className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-medium text-xs transition-colors shadow-sm"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Sign in with Google Account</span>
                  </a>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 border-t border-zinc-800" />
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">Or with email & password</span>
                    <div className="flex-1 border-t border-zinc-800" />
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
                  <span>Google OAuth is currently disabled.</span>
                  <button
                    onClick={() => setActiveTab("google_guide")}
                    className="text-emerald-400 hover:underline cursor-pointer"
                  >
                    View Setup Guide →
                  </button>
                </div>
              )}

              {/* Email & Password Form */}
              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                {isRegisterMode && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Full Name / Operator Handle
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Jamie Lee"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Email Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@fleethub.dev"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={isRegisterMode ? 12 : undefined}
                    maxLength={1024}
                    autoComplete={isRegisterMode ? "new-password" : "current-password"}
                    placeholder={isRegisterMode ? "Choose a password (at least 12 characters)" : "Enter password"}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400"
                  />
                </div>

                {isRegisterMode && (
                  <div>
                    <label htmlFor="bootstrap-token" className="block text-xs font-medium text-zinc-300 mb-1">
                      Installation setup token
                    </label>
                    <input
                      id="bootstrap-token"
                      type="password"
                      required
                      autoComplete="off"
                      value={bootstrapToken}
                      onChange={(event) => setBootstrapToken(event.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Use the FLEETHUB_BOOTSTRAP_TOKEN configured by the person installing FleetHub.</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-colors cursor-pointer shadow-md disabled:opacity-50"
                >
                  {loading
                    ? "Processing..."
                    : isRegisterMode
                    ? "Create Admin Account & Sign In"
                    : "Sign In with Password"}
                </button>
              </form>

              <div className="text-center pt-2 text-xs text-zinc-400">
                {isRegisterMode ? (
                  <span>
                    Already set up an account?{" "}
                    <button
                      type="button"
                      onClick={() => setIsRegisterMode(false)}
                      className="text-emerald-400 hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </span>
                ) : authStatus.registrationAvailable ? (
                  <span>
                    First time onboarding?{" "}
                    <button
                      type="button"
                      onClick={() => setIsRegisterMode(true)}
                      className="text-emerald-400 hover:underline cursor-pointer"
                    >
                      Create Initial Admin Password
                    </button>
                  </span>
                ) : <span>{statusLoaded ? "Account creation is closed. Sign in with the operator account." : "Checking whether first-operator registration is open…"}</span>}
              </div>
            </div>
          )}

          {/* TAB 2: GOOGLE OAUTH STEP-BY-STEP SETUP GUIDE */}
          {activeTab === "google_guide" && (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 space-y-1">
                <span className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Self-Service Google Auth (Zero Cloud Lock-in)
                </span>
                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  You create and own your Google Cloud OAuth application. FleetHub never manages or collects your Google client secrets.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center font-bold text-[11px] shrink-0">
                    1
                  </span>
                  <div className="space-y-1">
                    <span className="font-semibold text-white">Create OAuth 2.0 Client ID</span>
                    <p className="text-zinc-400 text-[11px]">
                      Open the Google Cloud Console credentials page and click <strong>Create Credentials → OAuth client ID</strong>.
                    </p>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline pt-0.5"
                    >
                      <span>Google Cloud Console Credentials</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center font-bold text-[11px] shrink-0">
                    2
                  </span>
                  <div className="space-y-1">
                    <span className="font-semibold text-white">Configure Authorized Redirect URI</span>
                    <p className="text-zinc-400 text-[11px]">
                      Select <strong>Web application</strong> as the application type, and paste this exact Redirect URI:
                    </p>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-emerald-300">
                      <span className="truncate" title={redirectUri}>{redirectUri}</span>
                      <button
                        onClick={copyRedirectUri}
                        className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer shrink-0 ml-auto"
                        title="Copy Redirect URI"
                      >
                        {copiedRedirect ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center font-bold text-[11px] shrink-0">
                    3
                  </span>
                  <div className="space-y-1">
                    <span className="font-semibold text-white">Set Environment Variables</span>
                    <p className="text-zinc-400 text-[11px]">
                      Add your client credentials to <code>compose.yml</code> or <code>.env</code>:
                    </p>
                    <pre className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto">
{`FLEETHUB_GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
# Required: allow only your operator Google emails:
FLEETHUB_ALLOWED_EMAILS="operator@gmail.com"`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="pt-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-[11px]">
                <strong className="text-white">Don't want Google Auth?</strong> Leave it off! You can always use the simple basic email & password authentication on the first tab.
              </div>
            </div>
          )}

          {/* TAB 3: CURRENT SESSION */}
          {activeTab === "session" && authStatus.authenticated && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{authStatus.user?.name}</h4>
                    <p className="text-xs text-zinc-400 font-mono">{authStatus.user?.email}</p>
                  </div>
                </div>
                <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/80">
                  <span>Provider: <strong className="text-zinc-300 capitalize">{authStatus.user?.provider}</strong></span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active Session</span>
                </div>
              </div>

              <button
                onClick={handleLogout}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-900 hover:bg-rose-950/40 text-rose-400 border border-zinc-800 hover:border-rose-500/30 font-medium text-xs transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out of FleetHub</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
