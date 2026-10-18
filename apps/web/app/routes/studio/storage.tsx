import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import {
  db,
  storageTargets,
  storageProviders,
  storageRoutes,
  type StorageProvider,
  type StorageRoute,
} from "@podstudio/db";
import { testStorageConnection } from "~/lib/storage.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { HelpPopover, HelpTerm } from "~/components/ui/help-popover";

// Screen 17 (Storage). Per BUILD_PLAN §4: `storage_targets(id, provider,
// endpoint, bucket, region, key_ref, routes json)` — revised on Tyler's
// direction so access/secret keys are entered through this screen's own
// form and stored in the DB, not through deploy/.env. They still never reach
// the browser after that: the loader below selects every column except
// `secretAccessKey`, and no action response ever echoes either key back.
// "Test connection" makes a real HeadBucket call rather than faking a
// result. The mockup's RadioGroup provider cards are built as plain radio
// inputs — no shadcn RadioGroup is installed yet, same kind of practical
// substitution as screen 02's hand-built table instead of TanStack.
const PROVIDER_LABELS: Record<StorageProvider, string> = {
  linode: "Linode Object Storage",
  "backblaze-b2": "Backblaze B2",
  wasabi: "Wasabi",
  r2: "Cloudflare R2",
  aws: "AWS S3",
  minio: "MinIO (self-hosted)",
};

const ROUTE_LABELS: Record<StorageRoute, string> = {
  raw: "Raw recordings",
  exports: "Exports",
  feedMedia: "Feed media",
};

export async function loader() {
  const targets = db
    .select({
      id: storageTargets.id,
      provider: storageTargets.provider,
      label: storageTargets.label,
      endpoint: storageTargets.endpoint,
      bucket: storageTargets.bucket,
      region: storageTargets.region,
      routes: storageTargets.routes,
      createdAt: storageTargets.createdAt,
    })
    .from(storageTargets)
    .orderBy(storageTargets.createdAt)
    .all();
  return { targets };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  const str = (name: string) => ((form.get(name) as string) || "").trim();

  if (intent === "add-target") {
    const provider = str("provider") as StorageProvider;
    const label = str("label");
    const endpoint = str("endpoint");
    const bucket = str("bucket");
    const region = str("region");
    const accessKeyId = str("accessKeyId");
    const secretAccessKey = str("secretAccessKey");

    if (!label) return { error: "Label is required." };
    if (!bucket) return { error: "Bucket is required." };
    if (!accessKeyId) return { error: "Access key ID is required." };
    if (!secretAccessKey) return { error: "Secret access key is required." };
    if (provider !== "aws" && !endpoint) {
      return { error: "Endpoint is required for this provider." };
    }

    db.insert(storageTargets)
      .values({
        id: crypto.randomUUID(),
        provider,
        label,
        endpoint: endpoint || null,
        bucket,
        region: region || null,
        accessKeyId,
        secretAccessKey,
        routes: [],
      })
      .run();
    return { added: true };
  }

  if (intent === "delete-target") {
    db.delete(storageTargets).where(eq(storageTargets.id, str("id"))).run();
    return { removed: true };
  }

  if (intent === "update-keys") {
    const id = str("id");
    const accessKeyId = str("accessKeyId");
    const secretAccessKey = str("secretAccessKey");
    if (!accessKeyId) return { error: "Access key ID is required.", keysTargetId: id };
    if (!secretAccessKey) return { error: "Secret access key is required.", keysTargetId: id };

    db.update(storageTargets)
      .set({ accessKeyId, secretAccessKey })
      .where(eq(storageTargets.id, id))
      .run();
    return { keysUpdated: id };
  }

  if (intent === "test-connection") {
    const id = str("id");
    const target = db.select().from(storageTargets).where(eq(storageTargets.id, id)).get();
    if (!target) return { error: "Storage target not found." };
    const result = await testStorageConnection(target);
    return { testResult: { targetId: id, ...result } };
  }

  if (intent === "set-routing") {
    const targets = db.select().from(storageTargets).all();
    const selected: Record<StorageRoute, string> = {
      raw: str("route-raw"),
      exports: str("route-exports"),
      feedMedia: str("route-feedMedia"),
    };
    for (const target of targets) {
      const routes = storageRoutes.filter((r) => selected[r] === target.id);
      db.update(storageTargets).set({ routes }).where(eq(storageTargets.id, target.id)).run();
    }
    return { routed: true };
  }

  return null;
}

export default function Storage({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: {
    error?: string;
    added?: boolean;
    removed?: boolean;
    routed?: boolean;
    keysUpdated?: string;
    keysTargetId?: string;
    testResult?: { targetId: string; ok: boolean; message: string };
  };
}) {
  const { targets } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [provider, setProvider] = useState<StorageProvider>("minio");
  const [editingKeysFor, setEditingKeysFor] = useState<string | null>(null);

  const routing: Record<StorageRoute, string> = { raw: "", exports: "", feedMedia: "" };
  for (const t of targets) {
    for (const r of (t.routes as StorageRoute[]) ?? []) {
      routing[r] = t.id;
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
          Podcast hosting
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
      </div>

      <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Targets</h2>
          <HelpPopover label="Storage targets">
            <HelpTerm term="access key / secret key">
              Entered here and stored server-side. Once saved, neither value
              is ever sent back to the browser again — "Update keys" always
              starts blank, it doesn't show what's currently stored.
            </HelpTerm>
            <HelpTerm term="test connection">
              Makes a real HeadBucket call against the target. Reports the
              actual result — including a real auth failure — rather than a
              canned success.
            </HelpTerm>
          </HelpPopover>
        </div>

        {targets.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No storage targets yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {targets.map((t) => {
              const result =
                actionData?.testResult?.targetId === t.id ? actionData.testResult : undefined;
              const editingKeys = editingKeysFor === t.id;
              const keysError = actionData?.keysTargetId === t.id ? actionData.error : undefined;
              return (
                <li key={t.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{t.label}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {PROVIDER_LABELS[t.provider as StorageProvider]} · {t.bucket}
                        {t.region ? ` · ${t.region}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="test-connection" />
                        <input type="hidden" name="id" value={t.id} />
                        <Button type="submit" variant="outline" size="sm" disabled={submitting}>
                          Test connection
                        </Button>
                      </Form>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingKeysFor(editingKeys ? null : t.id)}
                      >
                        Update keys
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-target" />
                        <input type="hidden" name="id" value={t.id} />
                        <Button type="submit" variant="ghost" size="sm" disabled={submitting}>
                          Remove
                        </Button>
                      </Form>
                    </div>
                  </div>
                  {result && (
                    <p className={`text-[12.5px] ${result.ok ? "text-ok" : "text-destructive"}`}>
                      {result.message}
                    </p>
                  )}
                  {actionData?.keysUpdated === t.id && (
                    <p className="text-[12.5px] text-ok">Keys updated.</p>
                  )}
                  {editingKeys && (
                    <Form
                      method="post"
                      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
                      onSubmit={() => setEditingKeysFor(null)}
                    >
                      <input type="hidden" name="intent" value="update-keys" />
                      <input type="hidden" name="id" value={t.id} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`accessKeyId-${t.id}`} className="text-[12px]">
                            New access key ID
                          </Label>
                          <Input id={`accessKeyId-${t.id}`} name="accessKeyId" required />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`secretAccessKey-${t.id}`} className="text-[12px]">
                            New secret access key
                          </Label>
                          <Input
                            id={`secretAccessKey-${t.id}`}
                            name="secretAccessKey"
                            type="password"
                            required
                          />
                        </div>
                      </div>
                      {keysError && <p className="text-[12.5px] text-destructive">{keysError}</p>}
                      <div>
                        <Button type="submit" size="sm" disabled={submitting}>
                          Save keys
                        </Button>
                      </div>
                    </Form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Separator />

        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="add-target" />

          <div className="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <div className="grid grid-cols-3 gap-2">
              {storageProviders.map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${
                    provider === p ? "border-ring bg-accent" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                    className="accent-primary"
                  />
                  {PROVIDER_LABELS[p]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" placeholder="Raw recordings bucket" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bucket">Bucket</Label>
              <Input id="bucket" name="bucket" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endpoint">
                Endpoint {provider !== "aws" ? "" : "(optional)"}
              </Label>
              <Input
                id="endpoint"
                name="endpoint"
                placeholder="https://s3.us-east-1.wasabisys.com"
                required={provider !== "aws"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="region">Region</Label>
              <Input id="region" name="region" placeholder="us-east-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="accessKeyId">Access key ID</Label>
              <Input id="accessKeyId" name="accessKeyId" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secretAccessKey">Secret access key</Label>
              <Input id="secretAccessKey" name="secretAccessKey" type="password" required />
            </div>
          </div>

          {actionData?.error && !actionData.keysTargetId && (
            <p className="text-[13px] text-destructive">{actionData.error}</p>
          )}
          {actionData?.added && <p className="text-[13px] text-ok">Added.</p>}

          <div>
            <Button type="submit" disabled={submitting}>
              Add storage target
            </Button>
          </div>
        </Form>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Routing</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Raw recordings, exports and feed media can each go to a different bucket.
        </p>

        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="set-routing" />
          {storageRoutes.map((r) => (
            <div key={r} className="flex flex-col gap-1.5">
              <Label htmlFor={`route-${r}`}>{ROUTE_LABELS[r]}</Label>
              <select
                id={`route-${r}`}
                name={`route-${r}`}
                defaultValue={routing[r]}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">Not set</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {actionData?.routed && <p className="text-[13px] text-ok">Routing saved.</p>}

          <div>
            <Button type="submit" disabled={submitting || targets.length === 0}>
              Save routing
            </Button>
          </div>
        </Form>
      </section>
    </div>
  );
}
