# SuryaSetu video guide — English and Hindi

A how-to series for customers and staff: every part of the SuryaSetu app and website, step by step, with narration.
There are 21 videos per language, in playlist order. Each folder is one YouTube playlist.

| Folder | Playlist name | Language |
|---|---|---|
| `english/` | SuryaSetu — Solar business app: full video guide (English) | English narration, English captions |
| `hindi/` | SuryaSetu — सोलर बिज़नेस ऐप: पूरी वीडियो गाइड (हिंदी) | Hindi narration, Hindi captions |

## What is in each folder

For every video `NN - Title`:

| File | What it is | Where it goes on YouTube |
|---|---|---|
| `NN - Title.webm` | The video: 1920×1080 (1080p), VP9 video, Opus audio with narration | Upload |
| `NN - Title.jpg` | Thumbnail, 1280×720 | Details → Thumbnail → Upload file |
| `NN - Title.srt` | Captions, timed to the narration | Subtitles → Add language → Upload file → *With timing* |

Two files describe the whole playlist:

- **`playlist.md`** lists every video in order, with its title, its description (chapters included) and its tags, ready to paste.
- **`youtube.csv`** holds the same details as a spreadsheet.

## The 21 videos (same order in both languages)

| # | English | हिंदी |
|---|---|---|
| 01 | Welcome to SuryaSetu: a quick tour | सूर्यसेतु में स्वागत: ऐप की एक झलक |
| 02 | Getting started: create your account and install the app | शुरुआत: अकाउंट बनाएं और ऐप इंस्टॉल करें |
| 03 | Company setup: profile, GST, print, WhatsApp | कंपनी सेटअप: प्रोफ़ाइल, GST, प्रिंट, WhatsApp |
| 04 | Team members, roles and access rights | टीम, रोल और एक्सेस के अधिकार |
| 05 | Leads: capture enquiries and follow up | लीड: इन्क्वायरी दर्ज करें और फॉलो-अप करें |
| 06 | Customers: one page for everything | कस्टमर: हर जानकारी एक पेज पर |
| 07 | Site survey and site photos with GPS | साइट सर्वे और GPS वाली साइट फ़ोटो |
| 08 | Quotations: GST quotes with savings | कोटेशन: GST कोटेशन बचत के साथ |
| 09 | GST invoices, payments and receipts | GST बिल, पेमेंट और रसीद |
| 10 | Projects and tasks | प्रोजेक्ट और काम |
| 11 | Products and stock | प्रोडक्ट और स्टॉक |
| 12 | Delivery challans: material to site | डिलीवरी चालान: साइट पर सामान |
| 13 | Purchase: vendors, orders and supplier payments | ख़रीद: वेंडर, ऑर्डर और सप्लायर पेमेंट |
| 14 | Installation: checklist, photos and certificate | इंस्टॉलेशन: चेकलिस्ट, फ़ोटो और सर्टिफ़िकेट |
| 15 | PM Surya Ghar subsidy and solar loans | PM सूर्य घर सब्सिडी और सोलर लोन |
| 16 | Service tickets and AMC contracts | सर्विस टिकट और AMC कॉन्ट्रैक्ट |
| 17 | Expenses, documents and your team | ख़र्चे, डॉक्यूमेंट और आपकी टीम |
| 18 | Lists like a pro: search, filters, views, export | लिस्ट का पूरा इस्तेमाल: सर्च, फ़िल्टर, व्यू, एक्सपोर्ट |
| 19 | Dashboard, reports and alerts | डैशबोर्ड, रिपोर्ट और अलर्ट |
| 20 | Backup, restore and keeping data safe | बैकअप, रीस्टोर और डेटा की सुरक्षा |
| 21 | Using SuryaSetu on your phone | फ़ोन पर सूर्यसेतु का इस्तेमाल |

## Uploading to YouTube (YouTube Studio)

Do this once per language.

1. **Create the playlist.** Go to Content → Playlists → New playlist. Use the name from the table above. Visibility: Public, or Unlisted to share only with your customers.
2. **Upload the videos in order, 01 to 21.** For each one, click Create → Upload videos and choose the `.webm` file. Then:
   - Paste the **Title** and **Description** from `playlist.md`. The description holds the chapters (the `0:00 …` lines), and YouTube turns them into chapters.
   - Upload the **thumbnail** `.jpg`. Custom thumbnails need a verified channel (phone verification).
   - Add it to the **playlist**.
   - Audience: *No, it's not made for kids*.
   - In **Show more**, paste the **Tags** from `playlist.md`.
   - Set **Video language**: English, or Hindi for the Hindi folder.
3. **Add the captions.** Open the video → Subtitles → Add language (English or Hindi) → Upload file → With timing → choose the `.srt` file.
4. **Check the order.** In the playlist, set Playlist settings → Ordering to *Manual*, and keep 01 to 21.
5. **Link the series.** You can add an end screen to each video linking to the next one. The last card of every video already says what comes next.

Tips:
- Put a link to your app's website and your WhatsApp number at the top of each description. The descriptions leave room for this.
- If you sell to businesses outside India, the English playlist is the one to share.

## What the videos show

- **Real screens.** Every video is recorded from the real SuryaSetu app with the **demo data** loaded: the sample company "Suryoday Solar Solutions", with sample customers across India. No real customer data appears.
- **Pointer and highlights.** A pointer moves to everything that is clicked, the clicked item is ringed in orange, and typing is shown at reading speed.
- **Camera scenes.** These show a drawn rooftop picture in place of a real camera. The location stamp is the app's real output for Patna, Bihar.
- **Narration.** The voices are Google text-to-speech: Indian English for English and Hindi for Hindi. The app's on-screen words stay in English in the Hindi videos, so viewers recognise the buttons.

## Making the videos again (after the app changes)

The videos are made by scripts in `scripts/videos/`.

| File | What it does |
|---|---|
| `lessons.mjs` and `lessons/*.mjs` | The 21 lessons: each scene's English and Hindi narration and what happens on screen |
| `engine.mjs` | Drives the app, the pointer and highlights, and the 1080p frame capture |
| `record.mjs` | Records the lessons from the running app |
| `build.py` | Speech, cards, timing, encoding, captions, thumbnails, playlists, and the checks on every file |

```sh
npm run build && npx vite preview --port 4173 &          # the app, served locally
export VIDEO_WORK=/tmp/suryasetu-videos                   # work folder (a few GB)
node scripts/videos/record.mjs                            # all lessons (or: record.mjs 05 08 for some)
python3 scripts/videos/build.py --work $VIDEO_WORK --out "user video" --lang en
python3 scripts/videos/build.py --work $VIDEO_WORK --out "user video" --lang hi
```

What the scripts need:
- Node with Playwright (already in the project).
- Python 3 with Pillow, numpy and gTTS. gTTS needs an internet connection for the speech.
- GStreamer with the `vpx`, `opus`, `mpg123` and `jpeg` plugins.

Each video is checked when it is built:
- 1920×1080 VP9 video with Opus audio;
- its length matches the timeline;
- every scene has narration.

A recording stops with an error if the app shows any error while recording. To change a narration, edit its lesson file and run `build.py` again for that lesson (`--only 08`); recording again is only needed when the screens change.
