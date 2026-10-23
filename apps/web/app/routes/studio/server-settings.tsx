import { useState } from "react";
import { Form, data, useNavigation } from "react-router";
import { Link } from "react-router";
import {
  getDomainInfo,
  listUsers,
  getCurrentUserId,
  getCurrentUserRole,
  changeOwnPassword,
  MIN_PASSWORD_LENGTH,
  addUser,
  updateUserRole,
  removeUser,
} from "~/lib/server-settings.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

// Screen 18 (Server settings). Per README: "Sidebar + Form: domain (Caddy
// auto-TLS status Badge), storage, AI keys (Whisper and LLM endpoints),
// LiveKit URL/keys, users Table (invite, role, remove via AlertDialog)."
//
// Domain: studio.tylerwoodward.me runs on Caddy's internal CA (LAN-only),
// not public ACME — there's no real "auto-TLS success" to report, and the
// spec itself says never fake a LAN-only check as a connectivity success.
// Shown as plain facts, not a status badge.
// Storage: already screen 17 — linked, not duplicated here.
// AI keys / LiveKit: zero schema, zero env vars, zero stage reached (BUILD_
// PLAN: "AI/LiveKit settings appear with their stages" — Stage 08 for
// LiveKit). Explicit deferral note, same treatment as screen 15's
// downloads/listeners.
// Users: real, backed by the existing Better Auth `users` table. "Invite"
// isn't buildable (still no email delivery — same gap as 16b's unlock
// flow), so this is "Add user": admin sets a password directly and shares
// it out-of-band, via Better Auth's own signUpEmail API (same as
// seed-admin.ts) — never labeled "invite," so it doesn't imply an email
// was sent.
//
// This file imports nothing from @podstudio/db, drizzle-orm or better-auth
// directly — all of that lives in server-settings.server.ts. See
// CHANGELOG, "Real bug: two sidebar links silently failed to navigate," for
// why that's a hard rule now.
const ROLES = ["admin", "editor"] as const;
type Role = (typeof ROLES)[number];

// A plain `defaultValue`/uncontrolled select keeps whatever the user last
// picked even when the server rejects the change (e.g. the last-admin
// guard) — there's nothing to make it snap back. Tried syncing local state
// from the server-confirmed `role` via useEffect first, but that effect
// only reruns when `role` actually *changes* between renders — on a
// rejection it's the same value before and after, so the effect never
// fires and the select stays stuck on the user's rejected pick. A plain
// controlled `value` tied straight to server truth has no such gap: on
// rejection `role` never moved, so the select never shows anything but the
// real value. On a successful change there's a brief flash back to the old
// value before the new loaderData arrives, which is an acceptable tradeoff
// against ever silently keeping a rejected value.
function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: Role;
  disabled: boolean;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="update-role" />
      <input type="hidden" name="id" value={userId} />
      <select
        name="role"
        value={role}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={disabled}
        className="rounded-md border border-input bg-transparent px-2 py-1 text-[12.5px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r[0].toUpperCase() + r.slice(1)}
          </option>
        ))}
      </select>
    </Form>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString();
}

export async function loader({ request }: { request: Request }) {
  const currentUserId = await getCurrentUserId(request);
  const role = await getCurrentUserRole(request);
  return {
    domain: getDomainInfo(),
    users: listUsers(),
    currentUserId,
    isAdmin: role === "admin",
    minPasswordLength: MIN_PASSWORD_LENGTH,
  };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  const str = (name: string) => ((form.get(name) as string) || "").trim();

  // Anyone signed in may change their OWN password...
  if (intent === "change-password") {
    // (not trimmed: passwords may legitimately start/end with spaces)
    const raw = (name: string) => String(form.get(name) ?? "");
    const result = await changeOwnPassword(request, {
      current: raw("currentPassword"),
      next: raw("newPassword"),
      confirm: raw("confirmPassword"),
    });
    if (!result.ok) return { passwordError: result.error };
    return data({ passwordChanged: true }, { headers: result.headers });
  }

  // ...but managing other accounts is admin-only. The layout loader only checks
  // that a session exists, so without this an editor could POST add-user /
  // update-role and promote themselves. Enforced here (server-side), not just
  // by hiding the controls.
  if (intent === "add-user" || intent === "update-role" || intent === "remove-user") {
    if ((await getCurrentUserRole(request)) !== "admin") {
      throw new Response("Only admins can manage users.", { status: 403 });
    }
  }

  if (intent === "add-user") {
    const name = str("name");
    const email = str("email");
    const password = str("password");
    const role = str("role") as Role;

    if (!name) return { error: "Name is required." };
    if (!email) return { error: "Email is required." };
    if (!password) return { error: "Temporary password is required." };

    const result = await addUser({ name, email, password, role });
    if (!result.ok) return { error: result.error };
    return { added: { email, password } };
  }

  if (intent === "update-role") {
    const id = str("id");
    const role = str("role") as Role;
    const result = updateUserRole(id, role);
    if (!result.ok) return { error: result.error, roleUpdateFailedId: id };
    return { roleUpdated: id };
  }

  if (intent === "remove-user") {
    const id = str("id");
    const currentUserId = await getCurrentUserId(request);
    const result = removeUser(id, currentUserId);
    if (!result.ok) return { error: result.error, removeFailedId: id };
    return { removed: true };
  }

  return null;
}

export default function ServerSettings({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: {
    error?: string;
    added?: { email: string; password: string };
    roleUpdated?: string;
    roleUpdateFailedId?: string;
    removeFailedId?: string;
    removed?: boolean;
    passwordError?: string;
    passwordChanged?: boolean;
  };
}) {
  const { domain, users, currentUserId, isAdmin, minPasswordLength } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Server</div>
        <h1 className="text-2xl font-semibold tracking-tight">Server settings</h1>
      </div>

      <section className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Domain</h2>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Hostname</span>
          <span className="font-mono text-[12.5px]">{domain.hostname}</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Caddy internal CA — LAN-only, not public ACME. No live connectivity
          check is performed here; a LAN-only reachability check can't stand
          in for a real public-TLS/connectivity status.
        </p>
      </section>

      <section className="mt-6 rounded-[14px] border border-border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Storage</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Managed on its own screen —{" "}
          <Link to="/studio/storage" className="underline hover:text-foreground">
            Storage
          </Link>
          .
        </p>
      </section>

      <section className="mt-6 rounded-[14px] border border-border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">AI keys &amp; LiveKit</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Not configured — these arrive with their own stages (AI endpoints
          and LiveKit's URL/keys both need real server-reachable
          infrastructure, not just this form). Nothing fabricated here in
          the meantime.
        </p>
      </section>

      <Separator className="my-6" />

      <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Your account</h2>
        <Form method="post" className="flex flex-col gap-3" key={actionData?.passwordChanged ? "changed" : "form"}>
          <input type="hidden" name="intent" value="change-password" />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={minPasswordLength} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            </div>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            At least {minPasswordLength} characters. Changing it signs you out everywhere else.
          </p>
          {actionData?.passwordError && <p className="text-[13px] text-destructive">{actionData.passwordError}</p>}
          {actionData?.passwordChanged && <p className="text-[13px] text-ok">Password changed.</p>}
          <div>
            <Button type="submit" variant="outline" disabled={submitting}>
              Change password
            </Button>
          </div>
        </Form>
      </section>

      <Separator className="my-6" />

      <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Users</h2>
        {!isAdmin && (
          <p className="text-[12.5px] text-muted-foreground">Only admins can add, change or remove users.</p>
        )}

        <ul className="flex flex-col gap-2">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const confirming = confirmingRemove === u.id;
            const removeError =
              actionData?.removeFailedId === u.id ? actionData.error : undefined;
            const roleError =
              actionData?.roleUpdateFailedId === u.id ? actionData.error : undefined;
            return (
              <li
                key={u.id}
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-[13px]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {u.name} {isSelf && <span className="text-muted-foreground">(you)</span>}
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {u.email} · joined {formatDate(u.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <RoleSelect userId={u.id} role={u.role ?? "editor"} disabled={submitting} />
                    ) : (
                      <span className="text-muted-foreground">{u.role ?? "editor"}</span>
                    )}

                    {!isAdmin ? null : confirming ? (
                      <>
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove-user" />
                          <input type="hidden" name="id" value={u.id} />
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            disabled={submitting}
                          >
                            Confirm remove
                          </Button>
                        </Form>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingRemove(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={isSelf}
                        title={isSelf ? "You can't remove your own account" : undefined}
                        onClick={() => setConfirmingRemove(u.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {removeError && <p className="text-[12.5px] text-destructive">{removeError}</p>}
                {roleError && <p className="text-[12.5px] text-destructive">{roleError}</p>}
              </li>
            );
          })}
        </ul>

        {isAdmin && <Separator />}

        {isAdmin && (
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="add-user" />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Temporary password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                defaultValue="editor"
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-[12.5px] text-muted-foreground">
            No invite email is sent — share this password with them directly.
          </p>

          {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
          {actionData?.added && (
            <p className="text-[13px] text-ok">
              Added. Share these credentials with them: <strong>{actionData.added.email}</strong> /{" "}
              <strong className="font-mono">{actionData.added.password}</strong>
            </p>
          )}

          <div>
            <Button type="submit" disabled={submitting}>
              Add user
            </Button>
          </div>
        </Form>
        )}
      </section>
    </div>
  );
}
