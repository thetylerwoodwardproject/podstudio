# Web Teleprompter UI Design

_Started 2026-09-24 14:51 UTC_

---

## User

Make UI mockups for a web based free teleprompter that I can have run on my phone, computer, and on multiple screens all at the same time, it needs to have username and password, it needs to be built on astro with tailwind css, and we must be able to select one of the instances rather if thats on the phone, computer to record the audio as a wav file, allow 16bit or 24bit, 44.1kHz or 48kHz recording, once episode is done, we can download our audio. This needs to run cleanly on Chrome based browsers. Firefox and Safari are not supported.

## User

It will also be audio only, no video.

## User

It will also be audio only, no video.

## Assistant

_[tool: read_skill_prompt]_

## User

I also want a clean, minimal design, I want auto scrolling depending on what the host says, follow the words perfectly.

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

I've made `Teleprompter.dc.html` with 8 screens. It's dark and minimal, with one red accent for recording:

- **1a** Username/password sign-in on desktop.
- **1b** Phone screen for joining a session, either from a list or with a code.
- **1c** Desktop control screen. You can pick which device records and choose 16- or 24-bit and 44.1 or 48 kHz; the file size per minute updates as you change them. You can also switch between voice follow and manual speed.
- **1d** The phone as the recording device. It shows the timer and audio level, and highlights each word as it's spoken. That highlighting is animated here to show voice follow.
- **1e** An external monitor that follows the recording device. Mirroring for a teleprompter glass can be turned on or off in Tweaks.
- **1f** The end-of-episode screen, where you download each take as a WAV or all of them as a zip.
- **1g** Controls on a phone that's only showing the script.
- **1h** A block screen for Firefox and Safari.

**Caveats:**
- These are mockups, not an Astro/Tailwind build. The styling is simple enough to move into Tailwind directly.
- Voice follow is designed around Chrome's built-in speech recognition. Chrome sends that audio to Google's servers to turn speech into text, so it needs an internet connection. Worth testing how well it keeps up before committing to it.

**Next steps:** an episode and script library, and a screen for when voice follow loses its place and catches up again.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

I fixed voice follow on the phone (1d) and the monitor (1e). The scroll now measures where the spoken word actually sits, so it should stay on the red reading line, but I haven't looked at it myself yet. A final check is running now.

I also removed the stray spaces in the 1e mirror label.

## User

Lets call it Podstudio, it will be free and self hosted, so we need to keep it easy for the listener. Once the episode is recorded, lets add a way to transcript it with Whisper, OpenAI API will be needed, so we'll need a settings panel to input that, also lets make sure we have 2FA built in, all of this needs to be web based, once server is online, it'll guide the user through, once transcript is generated, we can generate title suggestions, descriptions, x3 social post, generate chapters (start and stop time, titles (max of 45 characters), soundbites (start and end time, title (128 characters max).

## Assistant

_[tool: run_script]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

I renamed the app to Podstudio and added a new set of screens at the top of the file (turn 2):

- **2a** First-run setup. Once the server is online, it walks the user through five steps: server check, admin account, 2FA, OpenAI key, done. The mockup shows the 2FA step.
- **2b** Phone screen for entering the 2FA code at sign-in, with "trust this device" and a recovery-code link.
- **2c** Settings. The Transcription & AI section has the OpenAI key field with a Test button, and the Whisper and writing models. The Security section has 2FA, recovery codes and trusted devices. You can click between sections.
- **2d** Progress screen while Whisper transcribes the episode.
- **2e** The transcript, with tabs for titles, description, three social posts, chapters and soundbites. Chapters and soundbites have start and end times plus a character counter showing 45 and 128 as the limits; the counter turns red when a title goes over.

**Caveats:**
- OpenAI's API won't take files over 25 MB. A 24-bit/48 kHz WAV reaches that in about 3 minutes, so the server has to compress or split the audio before uploading it.
- The model names are placeholders, because OpenAI's model list changes.

## User

Just label "Social"

## Assistant

_[tool: dc_js_str_replace]_

That tab in 2e is now labelled "Social".

## User

In transcript, we need a way to label who is talking, same for teleprompter, so if we have a script with multiple people, they know who talks when

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

I added speaker labels as a new set of screens at the top (turn 3):

- **3a Script editor:** you start a line with "NAME:" to switch speakers. A Cast panel lists each person with their own color, and you can assign each screen to one person or to everyone.
- **3b Phone assigned to Sam:** Sam's lines stay bright and everyone else's are dimmed. A marker shows who is talking now, and the bottom bar shows who's next.
- **3c Transcript:** each segment is labelled with the speaker and their color. Lines that aren't in the script, like ad-libs, are marked "?" and get a one-tap "Who said this?" fix.

Whisper can't tell voices apart on its own, so speakers in the transcript come from matching it against the script's speaker lines. The older screens (1c, 1d, 1e, 2e) don't have speaker labels yet.

## User

allow custom colors along with a pre-selection of colors for each speaker. https://syntax.fm/system/colors

black, yellow, teal, green, red, purple

## Assistant

The page has no values in it; I'll pull them from the repo source.

_[tool: github_search_code]_

_[tool: web_fetch]_

_[tool: github_get_tree]_

_[tool: github_read_files]_

_[tool: run_script]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: grep]_

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

_[tool: write_file]_

Each speaker can now pick a color in the Cast panel in 3a: click Color, then choose one of the six presets or "+" for any custom color. The new color shows up immediately in 3b and 3c.

- **Where the colors come from:** the presets use Syntax's own color values, taken from the site's source code.
- **Brighter shades:** I used a brighter shade of each color so names stay readable on the dark screens. Red, purple and black are lighter than Syntax's base values, so "Black" shows as a light grey.
- **Low-contrast warning:** if a custom color is too dark to read, the panel says so under the swatches.
- **Red vs recording:** the red preset is close to the red used for the recording indicator. You may want to keep red off the speaker list.

## User

create a new page for a landing page for podstudio.dev advertising this free, open source tool for podcasters. List it's features and capabilities.

## User

let's also include a one line installer for the user to just copy and go, also let's suggest caddy or nginx reverse proxy for public facing access

## User

let's also include a one line installer for the user to just copy and go, also let's suggest caddy or nginx reverse proxy for public facing access

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

The Install section now defaults to a one-line installer, `curl -fsSL https://podstudio.dev/install.sh | bash`, with Docker as a second tab. Both have a copy button.

Below it is a new "Going public" block:
- It recommends a reverse proxy, with Caddy and Nginx configs you can switch between and copy. Caddy is marked as recommended because it handles HTTPS certificates for you.
- It explains that recording on phones or laptops over the internet needs HTTPS, because Chrome only allows the microphone on secure addresses.
- It lists the prerequisites: a domain, ports 80 and 443 open with 4321 closed, and 2FA kept on.

The install script, its URL and the example domain are placeholders until the real installer exists.

## User

certbot needed for caddy or nginx? if so lets point that out or include that in the overall project settings on the other page

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Certbot is only needed for Nginx. Caddy gets and renews HTTPS certificates on its own.

**Landing page:** the proxy tabs now read "Caddy · HTTPS built in" and "Nginx · needs Certbot". The Nginx config starts with the one-time `sudo certbot --nginx -d …` command, and the notes under each tab explain the difference.

**App settings (2c):** there's a new "Domain & HTTPS" section. It has:
- the public address
- a choice of Caddy, Nginx, or None (local only), with the steps for each; the Nginx option includes the Certbot command
- a status list for HTTPS, the certificate, WebSockets and port 4321

"None" makes clear that only the computer running Podstudio can record. Other devices can still show the prompter on your local network.

## User

generate a mockup of what the domain and https settings would look like

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

I added the Domain & HTTPS settings screen as a new section at the top (turn 4), shown in three states:

- **4a Healthy (Caddy):** a green "Secure and reachable" banner and a status list that's all green, noting that Caddy renews certificates automatically.
- **4b Needs attention (Nginx):** an amber banner warning that the certificate expires in 6 days because Certbot's renewal failed. It gives the two commands to fix it, and the certificate row is flagged amber.
- **4c Not set up (local only):** a check that your domain points to the server, followed by three steps: install Caddy, add the Caddyfile lines, open ports 80 and 443. It ends with "Check connection" and "Skip for now" buttons.

These three are static screens. The clickable version is still under Settings in 2c.

## User

add to the landing page its MIT licensed

## User

no give it its own section

## User

no give it its own section

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

MIT now has its own section, "Free forever. MIT licensed.", between How it works and Install.

It has:
- a short line saying there's no paid tier and no limits
- "Read the license" and "Contribute on GitHub" buttons (not linked yet)
- a four-cell grid: what you can do, plus "keep the copyright and license notice"

I took the "MIT licensed" card back out of Features, so it's back to nine cards. The badge, spec strip and footer mentions are still there.

## User

remove

## Assistant

_[tool: dc_html_str_replace]_

I removed "MIT licensed" from the spec strip.

## User

Add in the footer of the landing page that this is a project by Tyler Woodward which links to tylerwoodward.me

## Assistant

_[tool: dc_html_str_replace]_

The footer now reads "A project by Tyler Woodward" next to the Podstudio name. His name links to tylerwoodward.me and opens in a new tab.

## User

I want to add a dig at overly priced subscription services for a simple teleprompter.

## Assistant

_[tool: dc_html_str_replace]_

I added a full-width line just before the License section: "A teleprompter scrolls text. It shouldn't cost you a monthly subscription, a 'Pro' upgrade, and a watermark."

Below it, a smaller line: "Podstudio costs $0 a month. The only bill is OpenAI, and only if you use transcripts." It doesn't name any competitors.

## User

Add that it cost you a VPS or some local compute and electricty and internet

## Assistant

_[tool: dc_html_str_replace]_

The line now reads: "Podstudio itself costs $0 a month. You provide a VPS or a spare machine at home, the electricity and internet to run it, and OpenAI usage if you want transcripts."

## User

Any other improvements you can suggest?

## Assistant

Here are the gaps I'd close next, by priority.

**Missing flows (needed to ship)**
- **Episode and script library:** there's no home screen yet listing episodes, drafts and takes.
- **Script import:** paste text, or upload .txt, .docx, Google Docs or Markdown, with `NAME:` lines picked up as speakers automatically.
- **Mic check before recording:** pick the input, watch the level meter, and get a clipping warning.
- **Retake from here:** punch in at a line instead of starting a whole new take.
- **Voice-follow recovery:** what shows when it loses its place, how you jump back, and a keyboard shortcut to nudge it.

**Reliability (a self-hosted tool lives or dies here)**
- **Recording safety:** save audio in chunks as it records, so a closed tab or crash never loses a take. Show a "recovered take" screen when that happens.
- **Connection drops:** what the phone shows when Wi-Fi blips, and a clear signal that the recording is still safe on the recorder.
- **Storage:** show disk use on the server and warn before it fills up mid-episode.

**Hands-free control**
- Keyboard shortcuts, plus Bluetooth page-turner or foot-pedal support.
- A small remote view on a second phone, so a producer can pause, jump sections or change speed.

**Self-hosting**
- Add Domain & HTTPS as an optional step in the setup wizard.
- Backups: export and import everything (scripts, takes, transcripts, settings).
- Update notices: "v0.2 available" with a one-line upgrade command.
- Multiple users: invite a co-host with their own login and 2FA.

**Episode package**
- Export chapters in the formats podcast apps and YouTube use (Podcasting 2.0 JSON, ID3 tags, YouTube timestamps).
- Export soundbites as audio clips, not just timestamps.
- A settings field for your show's tone, so generated titles and posts sound like you.

**Landing page**
- A short screen recording of voice follow in action, instead of only the simulated demo.
- An FAQ covering why Chrome only, whether it works offline, and what OpenAI costs per episode.
- A docs link for the reverse proxy setup.

**Accessibility**
- Dyslexia-friendly font option, adjustable line spacing, and high-contrast prompter themes.
- Check speaker colors for color blindness. The red and purple presets may be hard to tell apart for some people.

I'd start with the library, recording safety and the mic check. Want me to mock those up?

## User

yes, let's do all those, lets allow the transcripts to be downloaded as srt or vtt

## Assistant

_[tool: update_todos]_

_[tool: run_script]_

_[tool: run_script]_

_[tool: ready_for_verification]_

_[tool: ready_for_verification]_

_[tool: update_todos]_

I've mocked up everything from the list as 15 new screens at the top of the app file (turn 5), and updated the landing page. Both are out for a final check.

**App screens**
- **Library (5a):** episode list with a warning when server storage is getting full.
- **Import (5b):** paste text, upload a file, or use a Google Docs link. Speakers and sections are picked up automatically.
- **Mic check (5c):** level meter, clipping and background-noise checks, and a test that voice follow can hear you.
- **Retake from a line (5d):** "Record from here" on any line. Each punch-in is saved as its own WAV.
- **Voice follow lost (5e):** suggests the likely next lines so you can tap where you are.
- **Connection dropped (5g):** the phone keeps scrolling, and it says clearly that the recording is safe on the recorder.
- **Producer remote (5i):** a second phone that can pause, change lines or jump between sections.
- **Recovered take (5f):** shown after a crash, since audio is saved every 5 seconds.
- **Controls (5h):** keyboard shortcuts, and mapping for page turners and foot pedals.
- **Setup wizard (5j):** Domain & HTTPS added as an optional step.
- **Server (5k):** update notice with a one-line upgrade, nightly backups, and export/import of everything.
- **Users (5l):** invite links, roles, and a guest role limited to shared episodes.
- **Export (5m):** transcripts as SRT, VTT, TXT or DOCX, with speaker names and caption-length settings. It includes an SRT preview and a VTT preview, plus Podcasting 2.0 and YouTube chapters and soundbite audio clips.
- **Show voice (5n):** describe your show's tone, list words to avoid, and paste example posts for the AI to match.
- **Prompter (5o):** easier-to-read fonts (Atkinson Hyperlegible, OpenDyslexic), line spacing, high-contrast and amber themes, and a color-blindness warning for speaker colors.

**Landing page**
- A video slot for a voice-follow demo, below the hero.
- An FAQ with six questions.
- Docs links in the nav and in the "Going public" section.
- The Whisper transcripts feature card now says you can download .srt and .vtt captions.

**Still placeholders:**
- Version numbers.
- The page turner model.
- The `--upgrade` installer flag.
- The demo video itself.

## User

when we do a new take how does that work in the final output when we download the file? is there a tone to indicate the new take?

## Assistant

Right now there's no tone, and nothing is joined together:

- **Full takes:** each one downloads as its own WAV, so Take 1, Take 2 and Take 3 are three separate files.
- **Punch-ins:** each one is also its own WAV, named after the line it starts on, for example `Ep142_Take3_L03_Four-I-counted.wav`.

You drop them into your editor and cut between them yourself.

I'd add a choice to the export screen (5m) called **"Takes: separate files / one combined file"**. The combined file would include:
- **Markers:** a named marker at every take and punch-in (Take 2, Punch-in, Line 18…). The marker is saved inside the WAV file. Reaper, Audition, Pro Tools and Logic can read these; Audacity only partly.
- **Tone (optional):** a short beep between takes, for example 1 kHz at a quiet −20 dB for half a second, so the joins are easy to spot in the waveform. It would be off by default, since the markers already show where takes start.
- **Take list:** a small .txt or .csv with each take's start time, line and duration, useful for editors that ignore markers.

Want me to add that to 5m? I can also add a "Tone between takes" switch to the recording settings.

## User

yes

## Assistant

_[tool: grep]_

_[tool: run_script]_

_[tool: ready_for_verification]_

I added take joining to the export screen and a tone switch to the recording settings. A final check is running now.

**Export screen (5m), Audio section:**
- A switch between "Separate files" and "One combined file". Combined is selected in the mockup.
- A small timeline of the combined file, with a marker at the start of Take 1, Take 2 and the punch-in on line 3.
- An option for markers at every take and punch-in, saved inside the WAV. It's on, with a note on which editors can read them.
- An option for a tone between takes: 1 kHz, −20 dB, half a second. It's off.
- An option for a take list (.csv) with each take's start time, first line and length. It's on.

**Studio control screen (1c):** a "Tone between takes" switch, off by default, under the recording settings.

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

Both issues are fixed:
- The breadcrumbs in the page headers ("Ep. 142 / Export" and the others) now stay on one line.
- In the 5m timeline, the punch-in section is wider, so its label "Punch-in L3" is no longer cut off.

An automatic check also flagged the phone prompter text as cut off at the bottom. That's the script scrolling past the bottom edge on purpose, so I left it.

## User

verify our landing page meets the new additions

## Assistant

_[tool: grep]_

_[tool: run_script]_

_[tool: grep]_

_[tool: ready_for_verification]_

The landing page was missing most of the new additions. It now covers them, and a final check is running.

**Features:** now 12 cards, which fills four full rows of three.
- **New cards:**
  - **Retakes and punch-ins:** separate files, or one WAV with markers, an optional tone and a take list.
  - **Never lose a take:** saved every 5 seconds, with crash recovery.
  - **Hands-free control:** shortcuts, page turners, foot pedals and a producer remote.
  - **Co-hosts and guests:** each person gets their own sign-in and 2FA, and guests can be invited with a link.
  - **Easy to read:** readable fonts, high-contrast themes and a color-blindness check.
- **Updated cards:**
  - **Voice follow:** suggests the next lines when it loses your place.
  - **Every screen:** keeps scrolling through Wi-Fi drops.
  - **Scripts:** import from files or a Google Docs link.
  - **WAV:** a mic check before each take.
  - **Transcripts:** adds .docx.
  - **Episode package:** your show's voice, Podcasting 2.0 and YouTube chapters, and soundbite clips.
  - **Self-hosting:** the domain step in the wizard, backups and updates.
- **Folded in:** the two-factor and "your key, your files" cards are now part of the co-hosts and self-hosting cards.

**Elsewhere:**
- **Spec strip:** added "Crash-safe takes".
- **How it works:** the Record and Publish steps now mention the mic check, retakes and the combined-file option.
- **FAQ:** added "How do retakes show up in the download?"

## User

how does recording happen with guest? all in one input, or can they record their part remotely and it pieces it together or provides each recording separtely ?

## Assistant

Right now it's all one input: one device records, and everyone has to be in the same room on that device's mic. Guests only get a prompter screen.

Three ways to handle guests:

1. **Same room, one mic (current).** Simplest, but it gives you one mixed track, so you can't adjust each voice separately.
2. **Same room, several mics.** The recording device uses a multichannel USB interface, and Podstudio saves one WAV per input channel, labelled with the speaker. There are no sync issues because it's all one clock.
3. **Remote, each person records themselves (double-ender).**
   - Every participant's browser records their own mic locally at full quality. Chunks upload to your server during the take, so a dropped connection loses nothing.
   - Podstudio lines the tracks up to a shared session clock. It also corrects small speed differences between devices, which add up over a long episode.
   - You download a separate WAV per speaker, all the same length and starting together, so they drop straight into your editor. An optional rough mix is available too.
   - To hear each other, Podstudio would need a built-in low-latency call (WebRTC), used only for monitoring and never recorded. The alternative is running Zoom or Discord alongside it. Headphones are required either way to avoid echo.
   - The prompter already syncs across devices, so a remote guest's screen follows the script and shows their own lines.

I'd build 2 and 3 together: every speaker becomes a track, whether the audio comes from an interface channel or a remote device. The export always gives one WAV per speaker plus an optional mix.

Want me to mock up the guest join and mic check, the host's track view during recording, and the multitrack export?

## User

Just Open Source

## Assistant

_[tool: dc_html_str_replace]_

The badge now reads "OPEN SOURCE".

## User

Add the to landing page that this was heavily assisted with the help of AI to assist in building the tool.

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

I added the AI disclosure in two places:

- **License section:** "Full disclosure: Podstudio was built with a lot of help from AI tools, for design, code and docs. A person reviews and tests every change, and the code is public so you can check it yourself."
- **Footer:** now reads "A project by Tyler Woodward, built with help from AI".

The claim that a person reviews and tests every change is my wording, so remove it if it doesn't match how you work.

## User

Add the guest recording bits about how their audio is handled if remote

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

I added a "Remote guests" section to the landing page, just before How it works, with a Guests link in the nav. It's out for a final check.

The section opens with "Every voice gets its own clean track." It covers:
- **Same room:** one mic, or a multichannel interface with one track per input.
- **Remote:** each guest records on their own device.

Beside that is a mock recording panel with three tracks (Tyler in the studio, Sam and Dana remote), each with a waveform and its upload status. One track shows as still uploading.

Below it, six short points on how remote audio is handled:
- It records locally at full quality.
- It uploads in 5-second chunks as you talk, and keeps recording if a guest's connection drops.
- All tracks share one clock and are corrected for speed differences between devices.
- You download one WAV per speaker, all starting together and the same length, with an optional rough mix.
- A built-in call lets everyone hear each other; it's never recorded, and headphones are required.
- Guest audio goes only to your server.

**Other updates:**
- **New FAQ:** "What does a remote guest need?", which also tells guests to keep the tab open until their upload finishes.
- **"Is my audio uploaded anywhere?" answer:** now includes guest tracks.
- **"Co-hosts and guests" card:** now mentions the separate synced tracks.

The app mockups don't have remote guest recording yet. I can add the guest join flow, the host's track view and the multitrack export next.

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

The waveforms in the Remote Guests track panel were invisible and should show now; the page loads without errors, but I haven't looked at them myself.

## User

do those waveforms show in the actual mockups?

## Assistant

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Yes. The other waveforms in the app mockups are built differently, so they don't have the problem the landing page had:

- **1f (episode wrapped):** each take row has a waveform, and it has a fixed height, so it displays.
- **5m (export):** the combined-file timeline uses solid colored blocks, not waveform bars.
- **1d and 3b (phone):** the small level meter uses fixed pixel heights.

I checked this by reading the code; I couldn't screenshot the file from here. If a waveform looks empty on your screen, point me to it.

The app has no multitrack remote guest view yet. The track panel on the landing page is the only one so far. Want me to add it to the app, along with the guest join flow and the per-speaker export?

## User

yes, i do not want to mislead the user. 

I think we also need to state on both the project mockups and landing page that this is not a Zoom like call service, you still need a way to connect to your guest and co-host if doing it remotely using tools such as Zoom, Slack, Teams, Discord, this just records.

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

_[tool: ready_for_verification]_

I removed the built-in call, and both files now say clearly that Podstudio only records. Both are out for a final check.

**App mockups:** a new section at the top (turn 6) with four screens:
- **6a Guest join (laptop):** three steps: join the call in your usual app, put on headphones, pick your mic. The mic check also looks for call audio leaking into the mic.
- **6b Host view:** one track per speaker, each showing a waveform, the device, upload status and clock offset. A banner reads "Podstudio records. It doesn't connect calls." with a line under it naming Zoom, Slack, Teams and Discord.
- **6c Guest phone after the take:** upload progress and "keep this tab open". It also says the call wasn't recorded.
- **6d Multitrack export:** one lined-up WAV per speaker, with an optional rough mix, markers, a take list and the tone between takes.

**Landing page:**
- **Remote guests section:** a Note box saying Podstudio doesn't connect calls and you still need Zoom, Slack, Teams or Discord. The "Hear each other" point is now "Bring your own call".
- **New FAQ:** "Is Podstudio a call app like Zoom?", answered no.
- **"What does a remote guest need?" answer:** now lists a separate call app.
- **Co-hosts card:** now ends with "You talk over your own call app."

## User

where can we condense things? Don't make changes, just suggest

## Assistant

**Landing page (biggest wins)**
- **Merge Features and Remote Guests.** The "Co-hosts and guests" card repeats the Remote Guests section. Drop the card and link to the section, which leaves 11 cards; merging "Easy to read" into another card gets back to an even 12 → 10.
- **Cut 2–3 feature cards.** "Never lose a take" and "Retakes and punch-ins" could be one "Takes you can trust" card. "Hands-free control" could fold into "Every screen at once".
- **Trim the six remote-guest points to three:** records locally and uploads as you go · lined up with one file per speaker · bring your own call and headphones. "Your server only" is already in the FAQ.
- **Choose between the subscription line and the License section.** Both argue "free". Move the subscription line into the License section as its headline and delete its own section.
- **"After the recording" overlaps the Episode package card.** Keep the section with the chapters visual and shorten the card to one line.
- **Shorten the FAQ from 9 to 6.** Keep Chrome, offline, OpenAI cost, call app, remote guest needs, retakes. "Is my audio uploaded", "guests without account" and "video" are answered elsewhere on the page.
- **Spec strip:** 7 items is a lot. Drop "Unlimited screens" and "Your server, your files", since both are covered in features.
- **Install and Going public:** turn the three "checks" bullets into one sentence.

**App mockups**
- **Retire superseded screens.** 1c, 1d and 1e have no speaker labels, and 1f is replaced by 5m and 6d. 2c overlaps 4a–4c and 5h–5o. Either mark them "superseded by …" or move them to a collapsed "Archive" turn.
- **One settings shell.** There are 8 separate settings screens (2c, 4a–c, 5h, 5k, 5l, 5n, 5o). 4a–4c could become one screen with a state toggle, like 2c already has.
- **Merge the export screens.** 5m (single recorder) and 6d (multitrack) are the same page. One export screen should show tracks when there's more than one speaker.
- **Merge the mic checks.** 5c (host) and 6a (guest) share the same checks list and could be one component with a "remote" variant.
- **Phone prompter states.** 1d, 1g, 3b, 5e, 5g and 6c are six phone screens. 3b is the real base; 5e and 5g are banners on top of it. Show them as one phone with a state switcher.
- **Turn intro notes.** Each turn repeats context that's now settled (Chrome-only, WAV spec, 2FA). A single "Product notes" block at the top would replace the six intro grids.
- **Recording format appears in 1c, 5c, 5m and 6a.** Settle on showing it only in the recording panel and export, and just reference it elsewhere.

My suggested priority: archive the superseded screens, merge the export and mic-check screens, then do the landing-page cuts in features, FAQ and subscription/License.

## User

yes, continue, i agree with suggestions

## Assistant

_[tool: copy_files]_

_[tool: update_todos]_

_[tool: run_script]_

_[tool: grep]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: run_script]_

_[tool: ready_for_verification]_

_[tool: ready_for_verification]_

_[tool: update_todos]_

I condensed both files; both are out for a final check. Copies from before the changes are in `archive/`.

**App mockups (new section at the top, turn 7)**
- **Product notes:** one block that replaces the separate intro notes on each section.
- **7a Settings:** one screen with all nine sections, including a new Recording section. You click the side menu to switch. Domain & HTTPS has a switch for its three states: healthy, needs attention, local only.
- **7b Export:** one screen for every kind of episode. It shows one track per speaker (a solo episode shows one) and a choice of separate files or one combined file. Captions, chapters and soundbites are all on the same screen.
- **7c Mic check:** one screen with a Host / Remote guest switch. The guest version adds the "join your call app first, wear headphones" step and the call-audio check.
- **7d Phone prompter:** one phone with a switch between Reading, Lost place, Reconnecting and Guest upload. It uses the speaker colors from 3a.
- **Older screens:** the 20 screens these replace are faded, with a link pointing to their replacement. The recording format now only appears in Recording settings and on the export screen.

**Landing page**
- **Features:** 12 cards down to 9.
- **Remote guests:** 6 points down to 3.
- **License section:** the subscription line is now its headline, and the cost-to-run text is in its paragraph. Its old separate section is gone.
- **FAQ:** 9 questions down to 6.
- **Spec strip:** 7 items down to 5.
- **Proxy checklist:** now one sentence.

Next, I can delete the faded screens outright, or merge 1c and 3a into one studio screen.

## User

another idea, can we add audio sweetening features to this such as EQ, compression, noise gate or downward expander? verify it meets podcast audio loudness standards? Or do we let them just export into their own DAW? Or give them options?

## Assistant

Yes. I'd give people options and keep the raw files untouched. People who use a DAW keep clean masters, and people who don't get a finished file.

**How I'd structure it**
1. **Raw (default).** The WAVs exactly as recorded, never altered. This is what DAW users want.
2. **Processed.** An extra download made on the server after recording, alongside the raw files, never replacing them. The chain per speaker:
   - **High-pass filter** (around 80 Hz) to cut rumble.
   - **Noise reduction**, light, learned from room tone.
   - **Downward expander** by default instead of a hard gate. It sounds more natural on voice and is less choppy between words. A gate is an option.
   - **EQ** presets: Warm, Clear, Broadcast, or off.
   - **Compression**, gentle, around 3:1.
   - **De-esser.**
   - **Loudness** set on the final mix, with a true-peak limiter.

   It would have one-click presets per speaker ("Studio mic", "Laptop mic", "Phone") and an Advanced panel with the actual settings. You'd get a before/after preview on a 30-second clip.
3. **Loudness check only.** Upload your finished DAW master and get a pass/fail report. Podstudio doesn't change the file.

**Loudness standards**
It would report integrated loudness (LUFS), true peak and loudness range, measured against a target you pick:
- **Podcast (common spec):** −16 LUFS stereo or −19 LUFS mono, true peak −1 dBTP.
- **Spotify / YouTube:** −14 LUFS.
- **Custom:** your own target.

The report would read something like: "−16.2 LUFS ✓ · −1.3 dBTP ✓ · LRA 6 LU".

**Worth knowing**
- Loudness targets apply to the final mix. For multitrack episodes, the processed option makes a mix; the raw tracks stay unprocessed.
- It all runs after recording, so it adds no latency and no load on the phone.
- The server does the processing, so a small VPS will be slow on long episodes. The screen should show an estimated time.
- The loudness targets are common industry guidance, not a rule enforced by every platform. I'd call them "recommended".

Want me to mock up the processing screen (presets, advanced settings, before/after preview), the loudness report, and the landing-page wording?

## User

lets leave this out then

## Assistant

Okay, I'll leave audio processing and loudness checks out. Podstudio stays a clean recorder: raw WAVs out, and people process them in their own DAW.

## User

one more thing, create a coming soon landing, this is another version for the project coming soon and what we are working on, pre-launch

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

I made the pre-launch page as `Podstudio Coming Soon.dc.html`, in the same style as the main landing page. It's out for a final check.

**What's on it**
- **Hero:** a "Coming soon · In development" badge and the headline "The teleprompter that listens is on its way."
- **Sign-up form:** a "Notify me at launch" email field that switches to a "You're on the list" message when submitted.
- **Demo:** an animated voice-follow preview labelled "Preview build".
- **What we're working on:** three columns, Working now, In progress and Up next, with three items each.
- **Three short notes:** free and MIT licensed, follow along on GitHub, built with help from AI.
- **Footer:** same as the main landing page.

**Before it goes live**
- **Roadmap statuses:** I guessed which column each item goes in, so move them to match where you actually are.
- **"Updated" date:** you can change it in Tweaks.
- **Email form:** nothing is sent anywhere yet. It needs a real sign-up service or your own endpoint, which is also why "No newsletter, no tracking" is only accurate once that's in place.
- **Links:** the GitHub links go nowhere yet.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

I fixed the two layout problems in the roadmap section:
- **Roadmap columns:** each column is now its own card. When the screen is narrow and one column drops to a second row, there's no longer a large grey gap beside it.
- **"Updated Sep 2026":** stays on one line.

