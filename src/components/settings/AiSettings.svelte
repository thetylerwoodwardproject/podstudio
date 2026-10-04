<script lang="ts">
  import {onMount} from 'svelte';
  import {api,nextPath} from '@/lib/api';
  import {beginSave} from '@/lib/save-status';
  import {loadSettings,saveSettings} from '@/lib/settings';
  import {Button} from '@/components/shadcn/button';
  import {Input} from '@/components/shadcn/input';
  import * as Field from '@/components/shadcn/field';
  import Spinner from '@/components/shadcn/spinner/Spinner.svelte';
  import StatusDot from '@/components/ui/StatusDot.svelte';
  let status=$state({configured:false,valid:false,status:'loading',suffix:''}),key=$state(''),busy=$state(false),error=$state(''),tone=$state(''),banned=$state('');
  onMount(async()=>{const s=loadSettings(); tone=s.ai.tone;banned=s.ai.bannedWords;try{status=await api('me/ai');}catch(e){error=(e as Error).message;}});
  async function action(method:'PUT'|'POST'|'DELETE'){busy=true;error='';const finish=beginSave();try{status=await api('me/ai',{method,...(method==='DELETE'?{}:{body:method==='PUT'?{key}:{}})});key='';finish('saved');}catch(e){error=(e as Error).message;finish(navigator.onLine?'error':'waiting');}finally{busy=false;}}
  function preferences(){const s=loadSettings();s.ai={tone,bannedWords:banned};saveSettings('ai',{tone,bannedWords:banned});}
</script>
<div class="grid gap-6" data-ai-settings>
  <section class="rounded-xl border border-border bg-surface p-5">
    <h2 class="mb-4 flex items-center gap-2 text-base"><StatusDot variant={status.valid?'success':status.configured?'warning':'muted'}/>{status.valid?'OpenAI connected':status.configured?'API key needs attention':'Add your OpenAI API key'}</h2>
    <Field.Group><Field.Field><Field.Label for="openai-key">API key</Field.Label><Input id="openai-key" type="password" autocomplete="off" bind:value={key} placeholder={status.configured?`Saved key ending ${status.suffix}`:'sk-…'} /><Field.Description>The key is encrypted on your server. It is never sent back to the browser. Audio is sent to OpenAI only when you choose Generate; OpenAI charges your account.</Field.Description></Field.Field></Field.Group>
    <div class="mt-4 flex flex-wrap gap-2"><Button type="button" disabled={busy||!key.trim()} onclick={()=>action('PUT')}>{#if busy}<Spinner label="Validating"/>{/if}Save and validate</Button>{#if status.configured}<Button type="button" variant="outline" disabled={busy} onclick={()=>action('POST')}>Test connection</Button><Button type="button" variant="destructive" disabled={busy} onclick={()=>action('DELETE')}>Remove key</Button>{/if}</div>
    {#if error}<p class="mt-3 text-sm text-rec" role="alert">{error}</p>{/if}
    <p class="mt-4 text-xs text-text-2">Transcription: whisper-1 · Writing: gpt-4.1-mini</p>
  </section>
  <section class="rounded-xl border border-border p-5"><Field.Group><Field.Field><Field.Label for="show-tone">Show voice</Field.Label><textarea id="show-tone" class="rounded-lg border border-border bg-control p-3" rows="3" maxlength={3000} bind:value={tone} onblur={preferences} placeholder="Describe your audience and the tone you want." ></textarea></Field.Field><Field.Field><Field.Label for="banned-words">Words to avoid</Field.Label><Input id="banned-words" maxlength={3000} bind:value={banned} onblur={preferences} /></Field.Field></Field.Group></section>
  {#if typeof location!=='undefined' && new URL(location.href).searchParams.has('next')}<a class="text-sm underline" href={nextPath('/')}>Back to episode preparation</a>{/if}
</div>
