---
name: Bug report
about: Something isn't working right
title: "[BUG] "
labels: bug
assignees: ''
---

## What happened

<!-- One sentence: what did you observe? -->

## What you expected instead

<!-- One sentence: what should have happened? -->

## Steps to reproduce

<!--
Be exact. Include:
- What kind of session you had built (e.g. "two segments, 5 min + 10 min, bell start cue on segment 2")
- Which button/action triggered it
- Whether it happens every time or only sometimes
-->

1. 
2. 
3. 

## Area of the app

<!-- Check all that apply -->

- [ ] Builder (session setup screen)
- [ ] Runner (active timer screen)
- [ ] Audio / sound cues
- [ ] Sound settings panel (gear icon)
- [ ] Bookmarks (save / load / delete)
- [ ] PWA / offline / install
- [ ] Theming / appearance
- [ ] Other: 

## Environment

**Browser + version:** <!-- e.g. Safari 18.4, Chrome 126, Firefox 128 -->  
**OS:** <!-- e.g. macOS 15.3, iOS 18, Android 14 -->  
**Installed as PWA?** <!-- Yes / No / Not sure -->  
**Build:** <!-- Dev server (`npm run dev`) / Production preview (`npm run build && npm run preview`) / Deployed site -->

## Console output

<!--
Open DevTools → Console before reproducing, then paste anything logged here.
If it's an audio bug, also check for AudioContext errors.
Include the full stack trace if there is one.
-->

```
(paste here, or "nothing logged")
```

## localStorage state

<!--
Helps reproduce session/bookmark bugs. In DevTools console, run:

  JSON.stringify({
    last: JSON.parse(localStorage.getItem('stillpoint.last') || 'null'),
    saved: JSON.parse(localStorage.getItem('stillpoint.saved') || 'null'),
    sound: JSON.parse(localStorage.getItem('stillpoint.sound') || 'null'),
  }, null, 2)

Paste the output here, or "not applicable" if this isn't a session/sound bug.
-->

```json
(paste here)
```

## Additional context

<!-- Screenshots, screen recordings, or anything else that would help. -->
