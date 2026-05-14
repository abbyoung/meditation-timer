# Gong Timer — PWA

Countdown timer with a gong alert that automatically switches to a stopwatch.

## Deploy to GitHub Pages

```bash
# 1. Create a new repo on github.com (e.g. "gong-timer"), then:
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/gong-timer.git
git push -u origin main

# 2. In the repo on GitHub:
#    Settings → Pages → Source: Deploy from branch → main / (root) → Save

# Your app will be live at:
#    https://YOUR_USERNAME.github.io/gong-timer/
```

## Add to iPhone Home Screen

1. Open the URL above in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add**

It will appear as a full-screen app with no browser chrome.

## Notes

- Works fully offline after first load (service worker caches everything)
- The gong sound is synthesized via Web Audio — no audio file needed
- On iOS, audio requires a user gesture first (the Start tap counts)
