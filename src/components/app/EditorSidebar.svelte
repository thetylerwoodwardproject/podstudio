<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    BookOpen,
    ChevronLeft,
    CircleHelp,
    FileAudio,
    FolderOpen,
    Gauge,
    Home,
    Import,
    Layers3,
    LogOut,
    Mic,
    PanelLeft,
    Pause,
    Settings,
    SlidersHorizontal,
    TimerReset,
    Upload,
  } from '@lucide/svelte';
  import StatusDot from '@/components/ui/StatusDot.svelte';
  import { api } from '@/lib/api';

  export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'failed' | 'conflict';

  let {
    episodeName,
    sessionsHref,
    studioHref,
    editorHref,
    manualHref = '/manual',
    settingsHref = '/settings/general',
    storageHref = '/settings/server',
    pendingRetakes = 0,
    pauseCount = 0,
    saveState = 'idle',
    onnavigate,
    onexport,
    onprepare,
    onmixer,
    onretakes,
    onpauses,
    onloudness,
    onimport,
    activeStage = 'editor',
    recordingHref,
  }: {
    episodeName: string;
    sessionsHref: string;
    studioHref: string;
    editorHref: string;
    manualHref?: string;
    settingsHref?: string;
    storageHref?: string;
    pendingRetakes?: number;
    pauseCount?: number;
    saveState?: EditorSaveState;
    onnavigate?: (href: string) => void | Promise<void>;
    onexport?: () => void;
    onprepare?: () => void | Promise<void>;
    onmixer?: () => void;
    onretakes?: () => void;
    onpauses?: () => void;
    onloudness?: () => void;
    onimport?: () => void;
    activeStage?: 'editor' | 'recording';
    recordingHref?: string;
  } = $props();

  let expanded = $state(false);
  let signingOut = $state(false);
  let storagePercent = $state<number | null>(null);
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    void api<{ disk: { total: number; free: number } | null }>('server')
      .then(({ disk }) => {
        if (!disk || disk.total <= 0) return;
        storagePercent = Math.max(0, Math.min(100, Math.round(((disk.total - disk.free) / disk.total) * 100)));
      })
      .catch(() => {
        // The rail remains useful when the server status endpoint is offline.
      });
  });

  function cancelCollapse() {
    if (collapseTimer === undefined) return;
    clearTimeout(collapseTimer);
    collapseTimer = undefined;
  }

  function scheduleCollapse() {
    cancelCollapse();
    if (!expanded) return;
    // Give the pointer room to cross the rail edge before closing the overlay.
    collapseTimer = setTimeout(() => {
      expanded = false;
      collapseTimer = undefined;
    }, 280);
  }

  onDestroy(cancelCollapse);

  function toggle() {
    cancelCollapse();
    expanded = !expanded;
  }

  function collapseIfFocusLeaves(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (expanded && (!next || !(event.currentTarget as HTMLElement).contains(next))) scheduleCollapse();
  }

  function labelForSave() {
    if (saveState === 'saving') return 'Saving project';
    if (saveState === 'saved') return 'Project saved';
    if (saveState === 'offline') return 'Waiting for connection';
    if (saveState === 'failed') return 'Couldn’t save project';
    if (saveState === 'conflict') return 'Save conflict';
    return 'Project is saved';
  }

  function storageVariant(): 'success' | 'warning' | 'error' | 'muted' {
    if (storagePercent === null) return 'muted';
    if (storagePercent >= 95) return 'error';
    if (storagePercent >= 80) return 'warning';
    return 'success';
  }

  function go(event: MouseEvent, href: string, saveBeforeNavigate = true) {
    // Global destinations behave like the dashboard's ordinary links. They
    // should not trigger an editor-project save just because the rail is open.
    if (!onnavigate || !saveBeforeNavigate) return;
    event.preventDefault();
    void onnavigate(href);
  }

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      const result = await api<{ next: string }>('auth/signout', { body: {} });
      location.href = result.next;
    } finally {
      signingOut = false;
    }
  }

  const item = 'group flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-text-2 transition-colors hover:bg-control hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary';
  const activeItem = 'border border-border bg-control text-text';
  // Keep navigation glyphs neutral across every route. StatusDot is reserved for status.
  const icon = 'size-4 flex-none text-text-2 transition-colors group-hover:text-text';
</script>

<aside
  data-editor-sidebar
  data-expanded={expanded}
  aria-label="Editor navigation"
  class={`z-50 flex h-full flex-col border-r border-divider bg-nav transition-[width] duration-200 motion-reduce:transition-none ${expanded ? 'absolute inset-y-0 left-0 w-[224px] shadow-[10px_0_28px_rgba(0,0,0,.28)]' : 'relative w-[52px]'}`}
  onpointerenter={cancelCollapse}
  onpointerleave={scheduleCollapse}
  onfocusin={cancelCollapse}
  onfocusout={collapseIfFocusLeaves}
>
  <div class="flex h-12 flex-none items-center border-b border-divider px-2">
    <button
      type="button"
      data-editor-sidebar-toggle
      class="flex size-8 items-center justify-center rounded-md text-text-2 hover:bg-control hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={expanded ? 'Collapse editor navigation' : 'Expand editor navigation'}
      title={expanded ? 'Collapse navigation' : 'Expand navigation'}
      aria-expanded={expanded}
      onclick={toggle}
    >
      {#if expanded}<ChevronLeft class="size-4" aria-hidden="true" />{:else}<PanelLeft class="size-4" aria-hidden="true" />{/if}
    </button>
    {#if expanded}<div class="min-w-0 flex-1 truncate pl-1 font-mono text-[10px] tracking-[0.14em] text-text-3">EDITOR</div>{/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
    <div class="mb-2 px-1.5 font-mono text-[9px] tracking-[0.14em] text-text-3" class:hidden={!expanded}>PROJECT</div>
    <nav class="space-y-1" aria-label="Project">
      <a href="/" class={item} title="Episodes" aria-label="Episodes" onclick={(event) => go(event, '/') }>
        <Home class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Episodes</span>{/if}
      </a>
      <a href={sessionsHref} class={item} title="Sessions" aria-label="Sessions" onclick={(event) => go(event, sessionsHref)}>
        <FolderOpen class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Sessions</span>{/if}
      </a>
      <a href={studioHref} class={item} title={episodeName} aria-label={`Open ${episodeName}`} onclick={(event) => go(event, studioHref)}>
        <FileAudio class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">{episodeName}</span>{/if}
      </a>
    </nav>

    <div class="my-4 border-t border-divider" class:hidden={!expanded}></div>
    <div class="mb-2 px-1.5 font-mono text-[9px] tracking-[0.14em] text-text-3" class:hidden={!expanded}>WORKFLOW</div>
    <nav class="space-y-1" aria-label="Workflow">
      {#if activeStage === 'recording'}
        <a href={recordingHref ?? studioHref} aria-current="page" class={`${item} ${activeItem}`} title="Recording" aria-label="Recording">
          <Mic class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Recording</span>{/if}
        </a>
      {:else}
        <a href={studioHref} class={item} title="Record new session" aria-label="Record new session" onclick={(event) => go(event, studioHref)}>
          <CircleHelp class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Record new session</span>{/if}
        </a>
      {/if}
      <a href={editorHref} aria-current={activeStage === 'editor' ? 'page' : undefined} class={`${item} ${activeStage === 'editor' ? activeItem : ''}`} title="Editor" aria-label="Editor">
        <Layers3 class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Editor</span>{/if}
      </a>
      {#if activeStage === 'editor'}
        <button type="button" class={item} title="Prepare episode" aria-label="Prepare episode" onclick={() => onprepare?.()}>
          <Upload class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Prepare episode</span>{/if}
        </button>
        <button type="button" class={item} title="Export" aria-label="Export" onclick={() => onexport?.()}>
          <Import class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Export</span>{/if}
        </button>
      {/if}
    </nav>

    {#if activeStage === 'editor'}
      <div class="my-4 border-t border-divider" class:hidden={!expanded}></div>
      <div class="mb-2 px-1.5 font-mono text-[9px] tracking-[0.14em] text-text-3" class:hidden={!expanded}>TOOLS</div>
      <nav class="space-y-1" aria-label="Editor tools">
      <button type="button" class={item} title="Mixer" aria-label="Mixer" onclick={() => onmixer?.()}>
        <SlidersHorizontal class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Mixer</span>{/if}
      </button>
      <button type="button" class={item} title={`Review retakes${pendingRetakes ? ` (${pendingRetakes})` : ''}`} aria-label={`Review retakes${pendingRetakes ? `, ${pendingRetakes} pending` : ''}`} onclick={() => onretakes?.()}>
        <TimerReset class={icon} aria-hidden="true" />{#if expanded}<span class="min-w-0 flex-1 truncate">Retakes</span>{#if pendingRetakes}<span class="font-mono text-[10px] text-warn">{pendingRetakes}</span>{/if}{/if}
      </button>
      <button type="button" class={item} title={`Review pauses${pauseCount ? ` (${pauseCount})` : ''}`} aria-label={`Review pauses${pauseCount ? `, ${pauseCount}` : ''}`} onclick={() => onpauses?.()}>
        <Pause class={icon} aria-hidden="true" />{#if expanded}<span class="min-w-0 flex-1 truncate">Pauses</span>{#if pauseCount}<span class="font-mono text-[10px] text-text-3">{pauseCount}</span>{/if}{/if}
      </button>
      <button type="button" class={item} title="Loudness" aria-label="Loudness" onclick={() => onloudness?.()}>
        <Gauge class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Loudness</span>{/if}
      </button>
      <button type="button" class={item} title="Import audio" aria-label="Import audio" onclick={() => onimport?.()}>
        <FileAudio class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Import audio</span>{/if}
      </button>
      </nav>
    {/if}
  </div>

  <div class="flex-none border-t border-divider px-2 py-3">
    <div class="space-y-1">
      <a href={settingsHref} class={item} title="Settings" aria-label="Settings" onclick={(event) => go(event, settingsHref, false)}>
        <Settings class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Settings</span>{/if}
      </a>
      <a href={manualHref} class={item} title="Manual" aria-label="Manual" onclick={(event) => go(event, manualHref, false)}>
        <BookOpen class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">Manual</span>{/if}
      </a>
      <button type="button" class={item} title="Sign out" aria-label="Sign out" disabled={signingOut} onclick={() => void signOut()}>
        <LogOut class={icon} aria-hidden="true" />{#if expanded}<span class="truncate">{signingOut ? 'Signing out…' : 'Sign out'}</span>{/if}
      </button>
      <a href={storageHref} class={item} title={storagePercent === null ? 'Storage' : `Storage: ${storagePercent}% used`} aria-label={storagePercent === null ? 'Storage' : `Storage: ${storagePercent}% used`} onclick={(event) => go(event, storageHref, false)}>
        <StatusDot variant={storageVariant()} size="sm" />{#if expanded}<span class="min-w-0 flex-1 truncate">Storage</span>{#if storagePercent !== null}<span class="font-mono text-[10px] tabular-nums text-text-3">{storagePercent}%</span>{:else}<span class="font-mono text-[10px] text-text-3">—</span>{/if}<span class="sr-only">{labelForSave()}</span>{/if}
      </a>
      <a href={storageHref} class="group/storage mt-1 block rounded-md px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" title={storagePercent === null ? 'Checking storage' : `${storagePercent}% used`} aria-label={storagePercent === null ? 'Checking storage' : `${storagePercent}% used`} onclick={(event) => go(event, storageHref, false)}>
        <div class="h-1 overflow-hidden rounded-full bg-track-off" aria-hidden="true">
          <div class="h-full rounded-full bg-accent transition-[width,background-color]" class:bg-warn={storagePercent !== null && storagePercent >= 80 && storagePercent < 95} class:bg-rec={storagePercent !== null && storagePercent >= 95} style={`width:${storagePercent ?? 0}%`}></div>
        </div>
        {#if expanded}<div class="mt-1 flex items-center justify-between font-mono text-[9px] tabular-nums text-text-3"><span>{storagePercent === null ? 'Checking…' : `${100 - storagePercent}% free`}</span><span>Server</span></div>{/if}
      </a>
    </div>
  </div>
</aside>
