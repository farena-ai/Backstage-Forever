# Optional voice and private memory

Typed questions always work. Voice is optional and uses compatible installed Windows desktop speech engines. A listed engine does not guarantee that your microphone, language or permissions are ready; if voice is unavailable, continue typing. BF does not change Windows privacy settings, install speech packs or silently switch to cloud transcription.

Hold the dictate control while speaking. Listening is visibly indicated. Release, Stop, Escape, leaving the page or switching characters stops the operation. Recognition may leave an incomplete draft: review and edit it before pressing Send. Dictation does not send a question by itself. Sending uses your selected AI connection and its existing access/billing terms. BF retains no audio file. A brief “Stopping” message means shutdown is still being confirmed. If Windows cannot confirm that the helper stopped, BF blocks further voice use and leaves typing available; it does not silently start another recording.

Read answer in AI Companion or Read plan on Adventure is a separate explicit local speech action. Stop interrupts it; starting dictation stops BF's own speech first. Missing voices or blocked audio leave the written answer available.

Save exchange stores a bounded reviewed conversation locally for the selected character. Saving is optional, and there is no automatic conversation archive or background summary. These local memories are readable app data, so avoid saving passwords or secrets. Review, delete individual exchanges, or clear the character's memory when wanted. Review excerpts are limited to 1,000 question characters and 2,000 answer characters. If leading whitespace would fill an entire excerpt, that whitespace is skipped in the review only; the full sent question, displayed answer and recent conversation stay unchanged. Save keeps exactly the excerpt shown.

Saving locally does not authorize future sharing. Select specific saved exchanges separately for each new question, inspect the preview, then explicitly Send. The preview uses the same bounded memory text sent with that question. Previous answers are unverified conversation, not proof about game progress. Private notes, goals and Company journeys are not automatically included. Changing character or connection clears conversation ownership. Leaving a page cancels pending work and retires review/voice tokens, while completed same-character conversation remains available when you return.

Profile backups omit memory by default. Importing a profile backup clears local memory in the replacement state; deleting a character or resetting local data removes its memory. Exported party plans never automatically include it. Data already sent to an AI provider remains subject to that provider's policies; deleting local memory does not delete the provider's records or cancel an already processed charge.

Real microphone behavior, recognition of game names and audible stop quality are part of the owner-led check before 1.0. Automated development uses fake audio workers and only safe installed-capability enumeration on the actual machine.

## Recent conversation versus saved memory

Recent completed questions and answers now accompany follow-ups without saving them permanently. Up to six exchanges are kept only while this app session is open; up to 6,000 characters of history fit inside the existing 12,000-character combined prompt limit. Older text can be omitted or clipped, while your current question and explicit memory selection stay intact. Prior AI suggestions remain unverified; current approved facts win.

Clear conversation removes this recent context and any unsaved review draft, without deleting saved memory. Reload, character/provider/access/source changes and import/reset/recovery replacement also clear it. Ordinary navigation keeps completed same-owner conversation. A sharing or saved-memory-selection change starts fresh. After a memory-bearing answer, a question with no memory selected does not silently resend that answer. Select the same saved exchanges again if you want that scope to continue.


## Local travel in Companion

Local sourced travel replies use the same original-question review and explicit memory save as other Companion exchanges. Saving does not automatically share anything. A later AI question sends a saved exchange only when selected for that question; a recognized local travel question sends nothing to a provider. Clear and privacy changes retire volatile trip continuation and choices; Stop retires the trip choice even when completed conversation remains. Navigation retains completed same-owner replies. Safe reply formatting supports paragraphs, lists, bold and inline code; model links, HTML and action-shaped JSON are inert.
