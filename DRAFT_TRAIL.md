# Draft Trail

Teacher header: **Record draft trail** / **Recording draft trail** (optional lesson name when starting). Teacher settings: **View Draft Trail**. Student writing-card header shows **Draft Trail on** with an explanation on hover.

While a trail is present, a quiet **red dot** can appear on a student writing card when the trail shows patterns worth a look (repeated or large pastes, or a sudden jump after quiet). The dot opens that student’s trail. It is a triage cue, not a cheating verdict, and has no label text on the card.

Capture is opt-in per room and begins with the current server-received text as a baseline. It records plain-text deltas after 10 seconds without a received change, or at most 30 seconds between checkpoints during continuous writing. Student sync retains the 700ms idle debounce with a 5-second maximum-wait sync. Accepted paste operations flush immediately and are labelled as browser-reported, not AI detection. Rich formatting, images, screens, audio and video are not recorded. Text changes temporarily reversed between sync/checkpoints may not appear.

Teacher notes and inline comments sent during recording are captured in sequence. The viewer shows before/after text with added and deleted spans, earlier feedback and a checkpoint slider. A later revision is not classified as successful feedback uptake. Detailed trails are fetched for one selected student, not broadcast with every live edit. A paused/reconnected interval is explicitly marked. Stop retains received work; it cannot capture an unsent final edit. Stopping shows a reminder to **Save session (.iboard)**. Reopening does not restart recording.

## Retention and identity

Trails are held only in this server process's memory. They survive student reconnects, but not server restarts. Save session (.iboard) preserves them with student names and an optional recording label; reopening remaps student IDs. Old session files without trails remain supported. New Class clears them. Removing a student card retains already-captured evidence as an archived named trail. Unsaved trails expire after 24 hours without changes. This policy concerns the new trail only, not the application's existing SQLite data.

Limits: 8 MiB serialized events per room, 64 MiB across rooms, 3,000 events per student and 500 tracked students per room. Capture stops visibly at a limit, without discarding existing events. Runtime memory is larger than serialized-event bytes because it includes current text, pending text and JavaScript overhead. No cloud archive or AI service added.

This is **drafting evidence, not an authenticator or authorship certificate**. Existing teacher/student joins are retained, including their current identity weaknesses. A typed name and room code are not verified identity. The feature's socket-role/room checks do not replace real server-enforced teacher authentication, student session ownership or school SSO. Those remain necessary before offering high-stakes authenticity guarantees. Client paste reports and exported JSON can be manipulated; this version does not claim tamper-proof evidence.

## Verification

From repository root:

```sh
node --test server/draftTrail.test.js
node client/scripts/draft-trail-smoke.mjs
npm run build --prefix client
```

The smoke test starts its own local server with temporary data and 30 student sockets. It never targets production. It checks role/room separation, paste and feedback capture, named session round trips, rejection of a malformed trail before replacing class data, and New Class reset. The unit simulation covers 45 minutes of continuous writing for 30 students; that particular synthetic workload produced approximately 310 KiB of serialized trails (not a universal storage estimate).

Browser visual testing is still needed, particularly narrow teacher headers, student join/reconnect indicators, keyboard access to the viewer, and paste rejection at the word limit. No production deployment is part of this change.
