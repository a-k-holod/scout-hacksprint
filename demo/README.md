# Scout demo video

The video is a 51-second recording of the running Scout app at `http://localhost:3000`, with local English narration. No Scout behavior was changed to make the footage.

## Files

- `scout-demo.mp4` — final video, 1280×800, H.264 and AAC, about 1.5 MB.
- `narration.txt` — the spoken script, 130 words.
- `title.html` and `end.html` — the opening and closing cards.

`frames/` and `narration.aiff` are local working files. `.gitignore` excludes those, plus `*.mp4`, so the video is not committed by accident. The file is still on disk for submission.

## How it was made

Tools already on this Mac: ffmpeg 9.0.1, macOS `say` with the Samantha voice, and the browser already available in Cursor. Playwright was not installed.

1. Samantha read `narration.txt` at 165 words per minute: `say -v Samantha -r 165 -o demo/narration.aiff -f demo/narration.txt`.
2. The browser opened the live app and submitted two real searches:
   - When was the James Webb Space Telescope launched? Find the official NASA source and verify the launch date and time.
   - Manhattan tech and AI events October 17–19, 2026 with food or swag.
3. Screenshots of those results became the video frames. The title cards were local HTML, also screenshotted.
4. ffmpeg joined the frames with the narration.

The James Webb result lists NASA Science pages first and says the excerpts are snippets, not full-page verification. The event result says no verified matching events were found. Undated pages stay under Unverified candidates, and directory pages are labeled as listings, not evidence.

## What you need to do

Play `demo/scout-demo.mp4`. Nothing else is required.

The dev server was already running and was left running. A fresh search will call Tavily again and can return different pages.
